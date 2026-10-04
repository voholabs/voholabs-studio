import { Injectable } from '@nestjs/common';
import { Prisma, WalletEntryType } from '@prisma/client';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export class InsufficientCreditsError extends Error {
  constructor(public needed: number, public balance: number) {
    super('Not enough credits');
  }
}

export interface NewWalletEntry {
  organizationId: string;
  amount: number;
  type: WalletEntryType;
  description: string;
  actionKey?: string;
  quantity?: number;
  unitPrice?: number;
  idempotencyKey?: string;
  reference?: string;
  paidAmount?: number;
  currency?: string;
  meta?: string;
  chargeKey?: string;
  actorId?: string;
}

// Free allowance applied inside a charge: `units` free per period, counted
// from `since` (undefined for once ever).
export interface FreeAllowance {
  units: number;
  since?: Date;
}

export const FREE_DESCRIPTION = 'Included free';

// Sum of quantity of SPEND entries for an action that were not refunded.
const usedUnitsQuery = async (
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  organizationId: string,
  actionKey: string,
  since?: Date
) => {
  const rows = await client.$queryRaw<{ used: bigint | number | null }[]>`
    SELECT COALESCE(SUM(s."quantity"), 0) AS used
    FROM "WalletEntry" s
    WHERE s."organizationId" = ${organizationId}
      AND s."type" = 'SPEND'
      AND s."actionKey" = ${actionKey}
      AND s."createdAt" >= ${since || new Date(0)}
      AND NOT EXISTS (
        SELECT 1 FROM "WalletEntry" r
        WHERE r."idempotencyKey" = 'refund:' || s."idempotencyKey"
      )`;
  return Number(rows[0]?.used || 0);
};

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === 'P2002';

@Injectable()
export class WalletRepository {
  constructor(
    private _wallet: PrismaRepository<'wallet'>,
    private _entry: PrismaRepository<'walletEntry'>,
    private _action: PrismaRepository<'billableAction'>,
    private _setting: PrismaRepository<'billingSetting'>,
    private _category: PrismaRepository<'billingCategory'>,
    private _post: PrismaRepository<'post'>,
    private _organization: PrismaRepository<'organization'>,
    private _transaction: PrismaTransaction
  ) {}

  settings() {
    return this._setting.model.billingSetting.findMany();
  }

  categories() {
    return this._category.model.billingCategory.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  actions(includeInactive = false) {
    return this._action.model.billableAction.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ provider: 'asc' }, { key: 'asc' }],
    });
  }

  action(key: string) {
    return this._action.model.billableAction.findUnique({ where: { key } });
  }

  getWallet(organizationId: string) {
    return this._wallet.model.wallet.findUnique({ where: { organizationId } });
  }

  getWalletByCustomer(stripeCustomerId: string) {
    return this._wallet.model.wallet.findFirst({ where: { stripeCustomerId } });
  }

  async ensureWallet(organizationId: string) {
    try {
      return await this._wallet.model.wallet.upsert({
        where: { organizationId },
        update: {},
        create: { organizationId },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      return this._wallet.model.wallet.findUniqueOrThrow({
        where: { organizationId },
      });
    }
  }

  updateWallet(organizationId: string, data: Prisma.WalletUpdateInput) {
    return this._wallet.model.wallet.update({
      where: { organizationId },
      data,
    });
  }

  async balance(organizationId: string) {
    const sum = await this._entry.model.walletEntry.aggregate({
      where: { organizationId },
      _sum: { amount: true },
    });
    return sum._sum.amount || 0;
  }

  entryByKey(idempotencyKey: string) {
    return this._entry.model.walletEntry.findUnique({
      where: { idempotencyKey },
    });
  }

  organizationSubscription(organizationId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: organizationId },
      select: { subscription: true },
    });
  }

  // Posts waiting to publish in a window, on the given providers, for the
  // forecast. Thread replies are rows of their own.
  scheduledPosts(
    organizationId: string,
    providers: string[],
    from: Date,
    to: Date
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId,
        state: 'QUEUE',
        deletedAt: null,
        publishDate: { gte: from, lte: to },
        integration: {
          providerIdentifier: { in: providers },
          deletedAt: null,
          disabled: false,
        },
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        integration: { select: { providerIdentifier: true } },
      },
      orderBy: { publishDate: 'asc' },
    });
  }

  // What has already been taken back for a top-up's payment (refunds and
  // disputes), as a negative number.
  async clawedBack(organizationId: string, paymentIntentId: string) {
    const sum = await this._entry.model.walletEntry.aggregate({
      where: {
        organizationId,
        type: 'ADJUST',
        reference: paymentIntentId,
        idempotencyKey: { startsWith: `chargeback:${paymentIntentId}:` },
      },
      _sum: { amount: true },
    });
    return sum._sum.amount || 0;
  }

  entries(
    organizationId: string,
    page: number,
    size: number,
    types?: WalletEntryType[]
  ) {
    const where: Prisma.WalletEntryWhereInput = {
      organizationId,
      ...(types?.length ? { type: { in: types } } : {}),
    };
    return Promise.all([
      this._entry.model.walletEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
      }),
      this._entry.model.walletEntry.count({ where }),
    ]);
  }

  // Units of an action charged and not refunded, since a date (or ever), for
  // the free allowance.
  usedUnits(organizationId: string, actionKey: string, since?: Date) {
    return this._transaction.model.$transaction((tx) =>
      usedUnitsQuery(tx, organizationId, actionKey, since)
    );
  }

  // Marks today's short-forecast notice as sent. True only for the first
  // caller of the UTC day, so concurrent callers notify once.
  async claimForecastNotice(organizationId: string, dayStart: Date) {
    const result = await this._wallet.model.wallet.updateMany({
      where: {
        organizationId,
        OR: [
          { forecastNotifiedAt: null },
          { forecastNotifiedAt: { lt: dayStart } },
        ],
      },
      data: { forecastNotifiedAt: new Date() },
    });
    return result.count > 0;
  }

  // Every top-up recorded since a date, across workspaces, for reconciling
  // with Stripe.
  topUpsSince(since: Date) {
    return this._entry.model.walletEntry.findMany({
      where: {
        type: { in: ['TOPUP', 'AUTO_TOPUP'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  entriesByKeys(idempotencyKeys: string[]) {
    if (!idempotencyKeys.length) {
      return Promise.resolve([]);
    }
    return this._entry.model.walletEntry.findMany({
      where: { idempotencyKey: { in: idempotencyKeys } },
    });
  }

  // Spending per action since a date, for the usage breakdown.
  usage(organizationId: string, since: Date) {
    return this._entry.model.walletEntry.groupBy({
      by: ['actionKey'],
      where: {
        organizationId,
        createdAt: { gte: since },
        type: { in: ['SPEND', 'REFUND'] },
      },
      _sum: { amount: true, quantity: true },
    });
  }

  // Spending per day since a date, for the chart.
  daily(organizationId: string, since: Date) {
    return this._entry.model.walletEntry.findMany({
      where: {
        organizationId,
        createdAt: { gte: since },
        type: { in: ['SPEND', 'REFUND'] },
      },
      select: { amount: true, createdAt: true },
    });
  }

  async autoTopUpSpentSince(organizationId: string, since: Date) {
    const sum = await this._entry.model.walletEntry.aggregate({
      where: { organizationId, type: 'AUTO_TOPUP', createdAt: { gte: since } },
      _sum: { paidAmount: true },
    });
    return sum._sum.paidAmount || 0;
  }

  // Adds an entry once. A repeated idempotency key returns the first entry.
  async add(entry: NewWalletEntry) {
    try {
      return await this._entry.model.walletEntry.create({ data: entry });
    } catch (err) {
      if (!isUniqueViolation(err) || !entry.idempotencyKey) {
        throw err;
      }
      return this._entry.model.walletEntry.findUniqueOrThrow({
        where: { idempotencyKey: entry.idempotencyKey },
      });
    }
  }

  // Spends credits if the balance covers them. The wallet row is locked for
  // the duration, so two charges at once cannot both see the same balance.
  // amount is positive here and stored negative.
  //
  // chargeKey names the thing being paid for (a post, say). It is charged at
  // most once while that charge stands; after a refund, the next attempt is
  // charged again under a new key (chargeKey#2, #3 ...).
  //
  // allowNegative charges even when the balance does not cover it, for
  // things already used (storage above the free amount), so the balance goes
  // below zero instead of the charge being lost.
  //
  // free applies the action's free allowance under the same lock: units still
  // free are not charged, and a charge that is entirely free is written as a
  // zero SPEND ("Included free") so it counts against the allowance.
  async spend(
    entry: NewWalletEntry & {
      chargeKey: string;
      allowNegative?: boolean;
      free?: FreeAllowance;
    }
  ) {
    const { chargeKey, allowNegative, free, ...data } = entry;
    return this._transaction.model.$transaction(async (tx) => {
      await tx.wallet.upsert({
        where: { organizationId: data.organizationId },
        update: {},
        create: { organizationId: data.organizationId },
      });
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "organizationId" = ${data.organizationId} FOR UPDATE`;

      const previous = {
        organizationId: data.organizationId,
        type: WalletEntryType.SPEND,
        chargeKey,
      };
      const [latest, count] = await Promise.all([
        tx.walletEntry.findFirst({
          where: previous,
          orderBy: { createdAt: 'desc' },
        }),
        tx.walletEntry.count({ where: previous }),
      ]);
      if (
        latest &&
        !(await tx.walletEntry.findUnique({
          where: { idempotencyKey: `refund:${latest.idempotencyKey}` },
        }))
      ) {
        return latest;
      }

      if (free && free.units > 0 && data.actionKey) {
        const used = await usedUnitsQuery(
          tx,
          data.organizationId,
          data.actionKey,
          free.since
        );
        const quantity = data.quantity ?? 1;
        const freeQuantity = Math.min(
          quantity,
          Math.max(0, free.units - used)
        );
        if (freeQuantity > 0) {
          data.amount = (quantity - freeQuantity) * (data.unitPrice || 0);
          data.meta = JSON.stringify({ freeQuantity });
          if (freeQuantity === quantity) {
            data.unitPrice = 0;
            data.description = FREE_DESCRIPTION;
          }
        }
      }

      if (data.amount > 0) {
        const sum = await tx.walletEntry.aggregate({
          where: { organizationId: data.organizationId },
          _sum: { amount: true },
        });
        const balance = sum._sum.amount || 0;
        if (!allowNegative && balance < data.amount) {
          throw new InsufficientCreditsError(data.amount, balance);
        }
      }

      return tx.walletEntry.create({
        data: {
          ...data,
          amount: data.amount ? -data.amount : 0,
          chargeKey,
          idempotencyKey: `${chargeKey}#${count + 1}`,
        },
      });
    });
  }
}
