import { Injectable, Logger } from '@nestjs/common';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  WalletBillingService,
  walletPaymentsEnabled,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import { WalletPlusService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service';
import {
  PLUS_ACTIVE_STATUSES,
  plusSpanPaid,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';

// How long after a span starts its invoice is looked for again, hourly.
const UNPAID_SPAN_REREAD_MS = 3 * 86_400_000;

// The reconciliation looks back this many days, once a UTC day, from this
// hour on.
const RECONCILE_DAYS = 2;
const RECONCILE_HOUR_UTC = 6;

// Periodic wallet jobs, run hourly by the wallet-housekeeping workflow (only
// where RUN_CRON starts it). Every step is idempotent and cheap, and one
// failing step never stops the others.
@Injectable()
export class WalletHousekeepingService {
  private _logger = new Logger(WalletHousekeepingService.name);
  private _reconciledOn?: string;

  constructor(
    private _media: MediaRepository,
    private _wallet: WalletService,
    private _billing: WalletBillingService,
    private _plus: WalletPlusService
  ) {}

  // Storage is not charged here: it is paid for when a file is uploaded
  // (WalletStorageService), once per unit, so nothing depends on this
  // workflow running.
  async run() {
    const plans = await this.step('plan credits', () => this.syncPlans());
    const notified = await this.step('short forecast notices', () =>
      this.notifyShort()
    );
    const reconciled = await this.step('reconciliation', () =>
      this.reconcile()
    );
    return { plans, notified, reconciled };
  }

  // Releases each Plus period's credits and expires the last period's
  // leftovers for workspaces that were not active to do it themselves. A
  // subscription still recorded as active after its paid span ended (its
  // renewal events were missed), or not ended with its span's invoice not
  // recorded as paid yet (a renewal being billed or collected), is read
  // again from Stripe first.
  private async syncPlans() {
    let synced = 0;
    const now = Date.now();
    for (const wallet of await this._wallet.plusWallets()) {
      const missedRenewal =
        PLUS_ACTIVE_STATUSES.includes(wallet.plusStatus || '') &&
        !!wallet.plusPeriodEnd &&
        wallet.plusPeriodEnd.getTime() <= now;
      // A renewal being billed (the first days of its span) or a failed
      // payment Stripe is still retrying; never one Stripe gave up on.
      const unpaidSpan =
        !plusSpanPaid(wallet) &&
        (wallet.plusStatus === 'past_due' ||
          (PLUS_ACTIVE_STATUSES.includes(wallet.plusStatus || '') &&
            !!wallet.plusPeriodStart &&
            now - wallet.plusPeriodStart.getTime() < UNPAID_SPAN_REREAD_MS));
      if (
        walletPaymentsEnabled() &&
        wallet.plusSubscriptionId &&
        (missedRenewal || unpaidSpan)
      ) {
        await this._plus
          .syncSubscription(wallet.plusSubscriptionId)
          .catch((err) =>
            this._logger.error(
              `Plus subscription ${wallet.plusSubscriptionId} could not be read again: ${err}`
            )
          );
      }
      await this._wallet.syncPlan(wallet.organizationId);
      synced++;
    }
    return synced;
  }

  private async step<T>(name: string, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (err) {
      this._logger.error(`Wallet housekeeping: ${name} failed: ${err}`);
      return undefined;
    }
  }

  // Tells each pay-as-you-go organization, at most once a day, when the paid
  // usage it has scheduled in the next 48 hours is not covered. The forecast
  // only looks at providers charged per post (X today) and returns at once
  // for an organization with nothing scheduled there.
  private async notifyShort() {
    let checked = 0;
    for (const org of await this._media.storageOfWalletOrganizations()) {
      if (hasAccess({ subscription: org.subscription })) {
        continue;
      }
      try {
        await this._wallet.notifyIfShort(org.organizationId);
        checked++;
      } catch (err) {
        this._logger.error(
          `Short forecast notice failed for ${org.organizationId}: ${err}`
        );
      }
    }
    return checked;
  }

  // Compares the ledger's top-ups with Stripe once a day and alerts only when
  // they disagree.
  private async reconcile() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (
      !walletPaymentsEnabled() ||
      this._reconciledOn === today ||
      now.getUTCHours() < RECONCILE_HOUR_UTC
    ) {
      return false;
    }
    const result = await this._billing.reconcile(RECONCILE_DAYS);
    this._reconciledOn = today;

    const stripeOnly = result.stripeOnly.length;
    const ledgerOnly = result.ledgerOnly.length;
    const mismatched = result.mismatched.length;
    if (stripeOnly || ledgerOnly || mismatched) {
      await walletAlert(
        `Reconciliation (last ${result.days} days): ${stripeOnly} paid in Stripe but not credited, ${ledgerOnly} credited without a Stripe payment, ${mismatched} with different amounts. Details: GET /admin/wallet/reconcile?days=${result.days}`
      );
    }
    return true;
  }
}
