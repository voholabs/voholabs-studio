import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  type: string;
  description: string;
  actionKey?: string;
  quantity?: number;
  unitPrice?: number;
  idempotencyKey?: string;
  reference?: string;
  amountPence?: number;
  meta?: string;
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === 'P2002';

@Injectable()
export class WalletRepository {
  constructor(
    private _wallet: PrismaRepository<'wallet'>,
    private _entry: PrismaRepository<'walletEntry'>,
    private _action: PrismaRepository<'billableAction'>,
    private _setting: PrismaRepository<'billingSetting'>,
    private _transaction: PrismaTransaction
  ) {}

  settings() {
    return this._setting.model.billingSetting.findMany();
  }

  setSetting(key: string, value: string) {
    return this._setting.model.billingSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
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

  upsertAction(
    key: string,
    data: Omit<Prisma.BillableActionCreateInput, 'key'>
  ) {
    return this._action.model.billableAction.upsert({
      where: { key },
      update: data,
      create: { key, ...data },
    });
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
    return this._wallet.model.wallet.update({ where: { organizationId }, data });
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

  entries(organizationId: string, page: number, size: number) {
    return Promise.all([
      this._entry.model.walletEntry.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
      }),
      this._entry.model.walletEntry.count({ where: { organizationId } }),
    ]);
  }

  // Spending per action since a date, for the usage breakdown.
  usage(organizationId: string, since: Date) {
    return this._entry.model.walletEntry.groupBy({
      by: ['actionKey'],
      where: {
        organizationId,
        createdAt: { gte: since },
        type: { in: ['spend', 'refund'] },
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
        type: { in: ['spend', 'refund'] },
      },
      select: { amount: true, createdAt: true },
    });
  }

  async autoTopUpPenceSince(organizationId: string, since: Date) {
    const sum = await this._entry.model.walletEntry.aggregate({
      where: { organizationId, type: 'auto_topup', createdAt: { gte: since } },
      _sum: { amountPence: true },
    });
    return sum._sum.amountPence || 0;
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
  async spend(entry: NewWalletEntry & { idempotencyKey: string }) {
    return this._transaction.model.$transaction(async (tx) => {
      await tx.wallet.upsert({
        where: { organizationId: entry.organizationId },
        update: {},
        create: { organizationId: entry.organizationId },
      });
      await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "organizationId" = ${entry.organizationId} FOR UPDATE`;

      const existing = await tx.walletEntry.findUnique({
        where: { idempotencyKey: entry.idempotencyKey },
      });
      if (existing) {
        return existing;
      }

      const sum = await tx.walletEntry.aggregate({
        where: { organizationId: entry.organizationId },
        _sum: { amount: true },
      });
      const balance = sum._sum.amount || 0;
      if (balance < entry.amount) {
        throw new InsufficientCreditsError(entry.amount, balance);
      }

      return tx.walletEntry.create({
        data: { ...entry, amount: -entry.amount },
      });
    });
  }
}
