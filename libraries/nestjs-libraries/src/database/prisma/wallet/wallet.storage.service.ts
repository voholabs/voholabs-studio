import { Injectable, Logger } from '@nestjs/common';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { WalletBillingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

// The price row for media storage. Its unit, free amount and price come from
// the row; nothing about the size of a unit or the free amount is in code.
export const STORAGE_ACTION_KEY = 'storage.gb';

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

// "gb" or "gb_month" -> bytes in one unit; undefined for anything else.
const bytesPerUnit = (unit: string) =>
  UNIT_BYTES[(unit || '').toLowerCase().split('_')[0]];

// The UTC month a charge belongs to, and where it starts.
const monthOf = (date = new Date()) => ({
  key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    '0'
  )}`,
  start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
});

// Media storage above the free amount, for organizations that pay from their
// wallet. Storage is already used when it is charged, so it may take the
// balance below zero; an upload is never refused for the balance.
//
// Every started unit above the free amount is charged once per UTC month:
// when the library first goes above it (covering to the month's end), and
// again at the start of each month for every unit still above. Going into a
// further unit mid-month charges only that unit.
//
// What a month already covers is read from the ledger, so deleting files and
// uploading them again in the same month never charges twice. The first charge
// of a month is one entry under `storage:<org>:<YYYY-MM>`; units added later
// that month are one entry each under `storage:<org>:<YYYY-MM>:<unit>`. Both
// are idempotent chargeKeys, so concurrent uploads and repeated monthly passes
// cannot charge a unit twice.
@Injectable()
export class WalletStorageService {
  private _logger = new Logger(WalletStorageService.name);
  // Units known to be paid for, per "<org>:<YYYY-MM>", so the hourly pass and
  // repeated uploads skip the ledger read once a month is covered. Only ever
  // a lower bound of the ledger (storage charges are not refunded).
  private _covered = new Map<string, number>();

  constructor(
    private _media: MediaRepository,
    private _wallet: WalletService,
    private _billing: WalletBillingService
  ) {}

  // The storage price row, or undefined when storage is not chargeable (no
  // active row, or a unit that is not a size). Fail closed: without it the
  // free plan's cap stays and nothing is charged.
  async rule() {
    const priced = await this._wallet.price(STORAGE_ACTION_KEY);
    if (!priced) {
      return undefined;
    }
    const unitBytes = bytesPerUnit(priced.action.unit);
    if (!unitBytes) {
      this._logger.error(
        `${STORAGE_ACTION_KEY} has unit "${priced.action.unit}", which is not a size; storage is not charged`
      );
      return undefined;
    }
    return {
      price: priced.price,
      unitBytes,
      freeUnits: Math.max(0, priced.action.freeUnits || 0),
    };
  }

  // Whole units above the free amount, usage rounded up.
  unitsOver(bytes: number, rule: { unitBytes: number; freeUnits: number }) {
    return Math.max(
      0,
      Math.ceil(Math.max(0, bytes) / rule.unitBytes) - rule.freeUnits
    );
  }

  // Whether this organization's storage has no hard cap because it pays for
  // it from the wallet. Paid plans and free organizations keep their plan's
  // cap.
  async liftsCap(organizationId: string) {
    return (
      (await this._wallet.paysFromWallet(organizationId)) &&
      !!(await this.rule())
    );
  }

  // After an upload: charge the units the library has gone into this month
  // that are not paid for yet. Never throws for the balance.
  async chargeCrossing(organizationId: string, bytesAfter?: number) {
    if (!(await this._wallet.paysFromWallet(organizationId))) {
      return 0;
    }
    const rule = await this.rule();
    if (!rule) {
      return 0;
    }
    const bytes =
      bytesAfter ?? (await this._media.getStorageUsed(organizationId));
    return this.coverUpTo(organizationId, this.unitsOver(bytes, rule), rule);
  }

  // The monthly charge for one organization: every unit still above the free
  // amount, once per month. Organizations on a paid plan are never charged;
  // a frozen wallet is still charged for storage it keeps using.
  async chargeMonth(organizationId: string) {
    const rule = await this.rule();
    if (!rule) {
      return 0;
    }
    const org = (await this._media.storageOfWalletOrganizations()).find(
      (o) => o.organizationId === organizationId
    );
    if (!org || hasAccess({ subscription: org.subscription })) {
      return 0;
    }
    return this.coverUpTo(
      organizationId,
      this.unitsOver(org.bytes, rule),
      rule
    );
  }

  // The monthly pass over every organization that has topped up. Safe to run
  // any time and as often as wanted: a month is charged once.
  async monthPass() {
    const rule = await this.rule();
    if (!rule) {
      return { charged: 0, organizations: 0 };
    }
    let charged = 0;
    let organizations = 0;
    for (const org of await this._media.storageOfWalletOrganizations()) {
      const units = this.unitsOver(org.bytes, rule);
      if (!units || hasAccess({ subscription: org.subscription })) {
        continue;
      }
      try {
        const added = await this.coverUpTo(org.organizationId, units, rule);
        if (added) {
          charged += added;
          organizations++;
        }
      } catch (err) {
        this._logger.error(
          `Storage month charge failed for ${org.organizationId}: ${err}`
        );
      }
    }
    return { charged, organizations };
  }

  // Units of storage this month's ledger already pays for (charges less
  // refunds).
  private async coveredThisMonth(organizationId: string, start: Date) {
    // TODO(merge): WalletService.charge applies an action's free units (B1).
    // Storage applies freeUnits itself, as a level and not a count of uses, so
    // storage.gb must be left out of that, or the first units above the free
    // amount would be given away each month.
    const usage = await this._wallet.usage(organizationId, start);
    return Math.max(
      0,
      usage.byAction.find((a) => a.key === STORAGE_ACTION_KEY)?.quantity || 0
    );
  }

  // Charges what is missing for `units` units this month. Returns the units
  // charged now.
  private async coverUpTo(
    organizationId: string,
    units: number,
    rule: { price: number }
  ) {
    if (units <= 0) {
      return 0;
    }
    const month = monthOf();
    const cacheKey = `${organizationId}:${month.key}`;
    if ((this._covered.get(cacheKey) || 0) >= units) {
      return 0;
    }
    let covered = await this.coveredThisMonth(organizationId, month.start);
    if (covered >= units) {
      this.remember(cacheKey, covered);
      return 0;
    }
    const monthKey = `storage:${organizationId}:${month.key}`;
    const before = covered;

    if (!covered) {
      const entry = await this.charge(
        organizationId,
        monthKey,
        units,
        rule.price
      );
      // Someone else may have charged this month's entry first, for fewer
      // units; the rest are charged one by one below.
      covered = Math.max(0, entry.quantity || 0);
    }

    for (let unit = covered + 1; unit <= units; unit++) {
      await this.charge(organizationId, `${monthKey}:${unit}`, 1, rule.price);
    }
    this.remember(cacheKey, units);
    return units - before;
  }

  private remember(cacheKey: string, units: number) {
    if (this._covered.size > 10_000) {
      this._covered.clear();
    }
    this._covered.set(cacheKey, units);
  }

  // Tries auto top-up first when the balance does not cover it, then charges
  // into a negative balance if it still does not.
  private async charge(
    organizationId: string,
    chargeKey: string,
    quantity: number,
    price: number
  ) {
    const amount = price * quantity;
    try {
      if ((await this._wallet.balance(organizationId)) < amount) {
        await this._billing.autoTopUp(organizationId, amount);
      }
    } catch (err) {
      this._logger.error(
        `Auto top-up before a storage charge failed for ${organizationId}: ${err}`
      );
    }
    return this._billing.charge({
      organizationId,
      actionKey: STORAGE_ACTION_KEY,
      chargeKey,
      quantity,
      allowNegative: true,
    });
  }
}
