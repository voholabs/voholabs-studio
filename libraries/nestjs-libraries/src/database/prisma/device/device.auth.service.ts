import { Injectable } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { randomInt } from 'crypto';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization } from '@prisma/client';

// OAuth 2.0 Device Authorization Grant (RFC 8628) for the CLI.
// The CLI polls /device/token with its device_code while the user approves the
// matching user_code in the browser. Everything lives in Redis with a TTL so no
// schema/migration is required; the token handed back is simply the org's
// existing API key (the same one the public API already accepts).
const DEVICE_TTL_SECONDS = 900; // 15 minutes to complete the flow
const POLL_INTERVAL_SECONDS = 5;

// Human-typed code: no ambiguous chars (0/O, 1/I/L), shown as XXXX-XXXX.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface DeviceRecord {
  status: 'pending' | 'approved';
  userCode: string;
  accessToken?: string;
  organizationId?: string;
}

@Injectable()
export class DeviceAuthService {
  constructor(private _organizationService: OrganizationService) {}

  private codeKey(deviceCode: string) {
    return `device:code:${deviceCode}`;
  }

  private userKey(userCode: string) {
    return `device:user:${userCode}`;
  }

  private normalizeUserCode(userCode: string) {
    return (userCode || '').toUpperCase().replace(/\s/g, '').trim();
  }

  private generateUserCode() {
    let raw = '';
    for (let i = 0; i < 8; i += 1) {
      raw += USER_CODE_ALPHABET.charAt(
        randomInt(USER_CODE_ALPHABET.length)
      );
    }
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  }

  async createDeviceCode() {
    const deviceCode = makeSecureId(40);
    const userCode = this.generateUserCode();

    const record: DeviceRecord = { status: 'pending', userCode };
    await ioRedis.set(
      this.codeKey(deviceCode),
      JSON.stringify(record),
      'EX',
      DEVICE_TTL_SECONDS
    );
    await ioRedis.set(
      this.userKey(userCode),
      deviceCode,
      'EX',
      DEVICE_TTL_SECONDS
    );

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${process.env.FRONTEND_URL}/device`,
      expires_in: DEVICE_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    };
  }

  // Called by the CLI (unauthenticated) polling with its device_code.
  async poll(deviceCode: string) {
    if (!deviceCode) {
      return { error: 'invalid_request' };
    }

    const raw = await ioRedis.get(this.codeKey(deviceCode));
    if (!raw) {
      return { error: 'expired_token' };
    }

    const record = JSON.parse(raw) as DeviceRecord;
    if (record.status === 'pending') {
      return { error: 'authorization_pending' };
    }

    if (record.status === 'approved' && record.accessToken) {
      // One-time use: consume both keys so the code can't be replayed.
      await ioRedis.del(this.codeKey(deviceCode));
      await ioRedis.del(this.userKey(record.userCode));

      return {
        access_token: record.accessToken,
        api_url: process.env.NEXT_PUBLIC_BACKEND_URL,
        organization_id: record.organizationId,
      };
    }

    return { error: 'expired_token' };
  }

  // Lets the browser page show whether a scanned/typed code is still valid
  // before the user commits to approving it.
  async getByUserCode(userCode: string) {
    const normalized = this.normalizeUserCode(userCode);
    if (!normalized) {
      return { valid: false };
    }

    const deviceCode = await ioRedis.get(this.userKey(normalized));
    if (!deviceCode) {
      return { valid: false };
    }

    const raw = await ioRedis.get(this.codeKey(deviceCode));
    if (!raw) {
      return { valid: false };
    }

    const record = JSON.parse(raw) as DeviceRecord;
    return { valid: true, alreadyApproved: record.status === 'approved' };
  }

  // Called by the authenticated browser page when the user clicks Approve.
  async approve(userCode: string, org: Organization) {
    const normalized = this.normalizeUserCode(userCode);
    const deviceCode = normalized
      ? await ioRedis.get(this.userKey(normalized))
      : null;
    if (!deviceCode) {
      return { success: false, error: 'invalid_code' };
    }

    const raw = await ioRedis.get(this.codeKey(deviceCode));
    if (!raw) {
      return { success: false, error: 'expired_code' };
    }

    // The org normally already has an API key (generated on creation); guard
    // the rare case where it doesn't so the CLI always receives a usable token.
    let apiKey = org.apiKey;
    if (!apiKey) {
      await this._organizationService.updateApiKey(org.id);
      const fresh = await this._organizationService.getOrgById(org.id);
      apiKey = fresh?.apiKey || null;
    }
    if (!apiKey) {
      return { success: false, error: 'no_api_key' };
    }

    const record: DeviceRecord = {
      status: 'approved',
      userCode: normalized,
      accessToken: apiKey,
      organizationId: org.id,
    };
    // Preserve the remaining TTL so an approved-but-never-polled code still
    // expires instead of lingering forever.
    const ttl = await ioRedis.ttl(this.codeKey(deviceCode));
    await ioRedis.set(
      this.codeKey(deviceCode),
      JSON.stringify(record),
      'EX',
      ttl > 0 ? ttl : DEVICE_TTL_SECONDS
    );

    return { success: true };
  }
}
