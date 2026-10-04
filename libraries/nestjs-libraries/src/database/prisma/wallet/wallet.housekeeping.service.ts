import { Injectable, Logger } from '@nestjs/common';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { WalletBillingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import { WalletStorageService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.storage.service';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

// The reconciliation looks back this many days, once a UTC day, from this
// hour on.
const RECONCILE_DAYS = 2;
const RECONCILE_HOUR_UTC = 6;

interface ReconcileResult {
  stripeOnly?: unknown[];
  ledgerOnly?: unknown[];
  mismatched?: unknown[];
}

// Methods other streams add to the wallet services. Looked up at run time so
// this works before and after they land.
// TODO(merge): call them directly once WalletService.notifyIfShort and the
// reconciliation (WalletService or WalletBillingService .reconcile(days)) are
// merged.
type MaybeNotify = { notifyIfShort?: (organizationId: string) => unknown };
type MaybeReconcile = {
  reconcile?: (days: number) => Promise<ReconcileResult | undefined>;
};

// Periodic wallet jobs, run hourly by the wallet-housekeeping workflow. Every
// step is idempotent and cheap, and one failing step never stops the others.
@Injectable()
export class WalletHousekeepingService {
  private _logger = new Logger(WalletHousekeepingService.name);
  private _reconciledOn?: string;

  constructor(
    private _media: MediaRepository,
    private _wallet: WalletService,
    private _billing: WalletBillingService,
    private _storage: WalletStorageService
  ) {}

  async run() {
    const storage = await this.step('storage month pass', () =>
      this._storage.monthPass()
    );
    const notified = await this.step('short forecast notices', () =>
      this.notifyShort()
    );
    const reconciled = await this.step('reconciliation', () =>
      this.reconcile()
    );
    return { storage, notified, reconciled };
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
    const notify = (this._wallet as WalletService & MaybeNotify).notifyIfShort;
    if (typeof notify !== 'function') {
      // TODO(merge): WalletService.notifyIfShort (stream S1).
      return 0;
    }
    let checked = 0;
    for (const org of await this._media.storageOfWalletOrganizations()) {
      if (hasAccess({ subscription: org.subscription })) {
        continue;
      }
      try {
        await notify.call(this._wallet, org.organizationId);
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
      this._reconciledOn === today ||
      now.getUTCHours() < RECONCILE_HOUR_UTC
    ) {
      return false;
    }
    const owner = [this._billing, this._wallet].find(
      (s) => typeof (s as unknown as MaybeReconcile).reconcile === 'function'
    ) as unknown as Required<MaybeReconcile> | undefined;
    if (!owner) {
      // TODO(merge): reconciliation (stream S1).
      return false;
    }
    const result = await owner.reconcile(RECONCILE_DAYS);
    this._reconciledOn = today;

    const count = (list?: unknown[]) => (Array.isArray(list) ? list.length : 0);
    const stripeOnly = count(result?.stripeOnly);
    const ledgerOnly = count(result?.ledgerOnly);
    const mismatched = count(result?.mismatched);
    if (stripeOnly || ledgerOnly || mismatched) {
      await walletAlert(
        `Reconciliation (last ${RECONCILE_DAYS} days): ${stripeOnly} paid in Stripe but not credited, ${ledgerOnly} credited without a Stripe payment, ${mismatched} with different amounts. Details: GET /admin/wallet/reconcile?days=${RECONCILE_DAYS}`
      );
    }
    return true;
  }
}
