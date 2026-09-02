import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { MediaMeterRepository } from '@gitroom/nestjs-libraries/database/prisma/media-meter/media-meter.repository';

export interface MediaMeterUsage {
  limit: number;
  used: number;
  reserved: number;
  available: number;
  percentUsed: number;
  resetAt: string | null;
}

// The three states the settings panel renders. This endpoint never throws for
// a missing setup or a dead upstream — the UI needs a shape, not a 500.
export type MediaMeterUsageResponse =
  | { state: 'not_configured' }
  | { state: 'unavailable' }
  | { state: 'ok'; usage: MediaMeterUsage };

// What resolveKey hands the MCP tools. The key never appears in any other
// shape - not in logs, not in error text, not in tool output.
export type MediaMeterKeyResolution =
  | { state: 'not_configured' }
  | { state: 'unavailable' }
  | { state: 'ok'; key: string };

// Settings can be opened repeatedly; don't hammer the meter for it.
const CACHE_TTL_MS = 45_000;
const UPSTREAM_TIMEOUT_MS = 5_000;

@Injectable()
export class MediaMeterService {
  private _cache = new Map<
    string,
    { at: number; value: MediaMeterUsageResponse }
  >();

  // In-flight mints by org id, so two tool calls landing together in the same
  // process share one mint instead of racing two. Cross-process races are
  // settled by the repository's conditional claim - see resolveKey.
  private _minting = new Map<string, Promise<MediaMeterKeyResolution>>();

  constructor(private _mediaMeterRepository: MediaMeterRepository) {}

  /**
   * Returns a usable meter key for the org, minting one lazily on first use so
   * every org - including every org that existed before this feature - is
   * covered without a backfill. Never throws and never logs the key: the
   * callers are agent tools, and their job on failure is to explain, not 500.
   */
  async resolveKey(orgId: string): Promise<MediaMeterKeyResolution> {
    const meterUrl = process.env.MCP_METER_URL;
    const adminToken = process.env.MCP_METER_ADMIN_TOKEN;
    if (!meterUrl || !adminToken) {
      return { state: 'not_configured' };
    }

    const stored = await this.readStoredKey(orgId);
    if (stored) {
      return stored;
    }

    const inFlight = this._minting.get(orgId);
    if (inFlight) {
      return inFlight;
    }

    const minting = this.mintAndClaim(orgId, meterUrl, adminToken).finally(
      () => {
        this._minting.delete(orgId);
      }
    );
    this._minting.set(orgId, minting);
    return minting;
  }

  private async readStoredKey(
    orgId: string
  ): Promise<MediaMeterKeyResolution | null> {
    const organization =
      await this._mediaMeterRepository.getMeterCredentials(orgId);
    if (!organization?.mediaMeterKey) {
      return null;
    }

    try {
      return {
        state: 'ok',
        key: AuthService.fixedDecryption(organization.mediaMeterKey),
      };
    } catch {
      // A stored key that will not decrypt (rotated NOT_SECRET, corrupt row)
      // is indistinguishable from no meter, and re-minting over it would need
      // a human's decision - so report the meter as unreachable instead.
      return { state: 'unavailable' };
    }
  }

  private async mintAndClaim(
    orgId: string,
    meterUrl: string,
    adminToken: string
  ): Promise<MediaMeterKeyResolution> {
    const organization =
      await this._mediaMeterRepository.getMeterCredentials(orgId);

    const minted = await this.mintKey(
      meterUrl,
      adminToken,
      organization?.name ? `${organization.name} (${orgId})` : orgId,
      // The meter walks this forward to the current boundary itself, so handing
      // it the original date rather than a computed period start keeps the true
      // anniversary - including month-end ones, which drift if you advance them
      // a month at a time.
      organization?.subscription?.createdAt ?? organization?.createdAt ?? null
    );
    if (!minted) {
      return { state: 'unavailable' };
    }

    const claimed = await this._mediaMeterRepository.claimMeterKey(
      orgId,
      minted.id,
      AuthService.fixedEncryption(minted.key)
    );

    if (claimed.count > 0) {
      return { state: 'ok', key: minted.key };
    }

    // Another process claimed first; its key is the org's key. The one minted
    // here is never stored and never used - it idles at the meter, harmless.
    return (await this.readStoredKey(orgId)) || { state: 'unavailable' };
  }

  private async mintKey(
    meterUrl: string,
    adminToken: string,
    label: string,
    periodStart: Date | null
  ): Promise<{ id: string; key: string } | null> {
    try {
      const response = await fetch(
        `${meterUrl.replace(/\/+$/, '')}/admin/keys`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          // No creditLimit on purpose: the meter's own default (500 credits at
          // time of writing) is the policy, and restating it here would freeze
          // it in a second place. periodStart is ours to set, though - only we
          // know when this customer's subscription renews.
          body: JSON.stringify({
            label,
            ...(periodStart ? { periodStart: periodStart.toISOString() } : {}),
          }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      if (typeof body?.id !== 'string' || typeof body?.key !== 'string') {
        return null;
      }

      return { id: body.id, key: body.key };
    } catch {
      return null;
    }
  }

  async getUsage(orgId: string): Promise<MediaMeterUsageResponse> {
    const meterUrl = process.env.MCP_METER_URL;
    const adminToken = process.env.MCP_METER_ADMIN_TOKEN;
    if (!meterUrl || !adminToken) {
      return { state: 'not_configured' };
    }

    // Mint on view, not only on first edit. A workspace that has not touched
    // media editing yet still has an allowance waiting for it, and telling
    // someone asking about their credit that they are "not connected" is both
    // discouraging and untrue - they would get the full amount the moment they
    // tried. resolveKey is the same path the tools take, so opening Settings
    // and running an edit can never disagree about which key is theirs.
    const resolved = await this.resolveKey(orgId);
    if (resolved.state !== 'ok') {
      return { state: resolved.state };
    }

    const organization = await this._mediaMeterRepository.getMeterKeyId(orgId);
    const keyId = organization?.mediaMeterKeyId;
    if (!keyId) {
      return { state: 'unavailable' };
    }

    // "unavailable" is cached too, so a dead meter costs one timeout per TTL
    // window instead of one per settings open.
    const cached = this._cache.get(keyId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

    const value = await this.fetchUsage(meterUrl, adminToken, keyId);
    this._cache.set(keyId, { at: Date.now(), value });
    return value;
  }

  private async fetchUsage(
    meterUrl: string,
    adminToken: string,
    keyId: string
  ): Promise<MediaMeterUsageResponse> {
    try {
      const response = await fetch(
        `${meterUrl.replace(/\/+$/, '')}/admin/usage/${encodeURIComponent(
          keyId
        )}`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        return { state: 'unavailable' };
      }

      const body = await response.json();
      const numbers = ['limit', 'used', 'reserved', 'available', 'percentUsed']
        .map((field) => body?.[field]);
      if (numbers.some((value) => typeof value !== 'number')) {
        return { state: 'unavailable' };
      }

      return {
        state: 'ok',
        usage: {
          limit: body.limit,
          used: body.used,
          reserved: body.reserved,
          available: body.available,
          percentUsed: body.percentUsed,
          resetAt: typeof body.resetAt === 'string' ? body.resetAt : null,
        },
      };
    } catch {
      return { state: 'unavailable' };
    }
  }
}
