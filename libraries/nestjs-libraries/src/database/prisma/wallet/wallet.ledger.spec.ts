import {
  InsufficientCreditsError,
  WalletRepository,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.repository';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';

// An in-memory stand-in for the Prisma models the wallet ledger touches.
// Enough of `where` is understood for the repository's queries: equality,
// `startsWith`, `in` and `gte`. Duplicate idempotency keys throw P2002 like
// the real unique index.
type Row = Record<string, any>;

const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('startsWith' in cond) {
        return typeof value === 'string' && value.startsWith(cond.startsWith);
      }
      if ('in' in cond) {
        return cond.in.includes(value);
      }
      if ('gte' in cond) {
        return value >= cond.gte;
      }
      return false;
    }
    return value === cond;
  });

const fakeDb = () => {
  const entries: Row[] = [];
  const wallets: Row[] = [];
  let clock = 0;

  const walletEntry = {
    create: async ({ data }: { data: Row }) => {
      if (
        data.idempotencyKey &&
        entries.some((e) => e.idempotencyKey === data.idempotencyKey)
      ) {
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      const row = {
        id: `e${entries.length + 1}`,
        quantity: 1,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, clock++)),
        ...data,
      };
      entries.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: Row }) =>
      entries.find((e) => matches(e, where)) || null,
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const row = entries.find((e) => matches(e, where));
      if (!row) {
        throw new Error('Not found');
      }
      return row;
    },
    findFirst: async ({ where }: { where: Row }) =>
      entries
        .filter((e) => matches(e, where))
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null,
    count: async ({ where }: { where: Row }) =>
      entries.filter((e) => matches(e, where)).length,
    aggregate: async ({ where }: { where: Row }) => {
      const rows = entries.filter((e) => matches(e, where));
      return {
        _sum: {
          amount: rows.length
            ? rows.reduce((s, e) => s + (e.amount || 0), 0)
            : null,
          paidAmount: rows.length
            ? rows.reduce((s, e) => s + (e.paidAmount || 0), 0)
            : null,
        },
      };
    },
  };

  const wallet = {
    upsert: async ({ where, create }: { where: Row; create: Row }) => {
      let row = wallets.find((w) => matches(w, where));
      if (!row) {
        row = {
          firstTopUpAt: null,
          currency: null,
          frozenAt: null,
          autoTopUp: false,
          ...create,
        };
        wallets.push(row);
      }
      return row;
    },
    findUnique: async ({ where }: { where: Row }) =>
      wallets.find((w) => matches(w, where)) || null,
    update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = wallets.find((w) => matches(w, where));
      Object.assign(row, data);
      return row;
    }),
  };

  const model: Row = {
    walletEntry,
    wallet,
    $queryRaw: async () => [],
  };
  model.$transaction = async (cb: (tx: Row) => any) => cb(model);

  return { entries, wallets, model };
};

const setup = () => {
  const db = fakeDb();
  const repo = { model: db.model } as any;
  const repository = new WalletRepository(
    repo,
    repo,
    repo,
    repo,
    repo,
    repo,
    repo,
    repo
  );
  const service = new WalletService(repository);
  return { db, repository, service };
};

const ORG = 'org-1';

const spendPost = (
  repository: WalletRepository,
  amount: number,
  extra: { allowNegative?: boolean; chargeKey?: string } = {}
) =>
  repository.spend({
    organizationId: ORG,
    amount,
    type: 'SPEND',
    actionKey: 'x.post',
    quantity: 1,
    unitPrice: amount,
    description: 'Post on X',
    chargeKey: extra.chargeKey || 'post:p1',
    allowNegative: extra.allowNegative,
  });

const credit = (repository: WalletRepository, amount: number, key = 'g1') =>
  repository.add({
    organizationId: ORG,
    amount,
    type: 'GRANT',
    description: 'test credit',
    idempotencyKey: key,
  });

describe('WalletRepository.spend', () => {
  it('stores the first charge for a chargeKey as <chargeKey>#1, negative', async () => {
    const { repository } = setup();
    await credit(repository, 1000);
    const entry = await spendPost(repository, 225);
    expect(entry.idempotencyKey).toBe('post:p1#1');
    expect(entry.amount).toBe(-225);
    expect(await repository.balance(ORG)).toBe(775);
  });

  it('returns the standing charge instead of charging the same chargeKey twice', async () => {
    const { repository, db } = setup();
    await credit(repository, 1000);
    const first = await spendPost(repository, 225);
    const second = await spendPost(repository, 225);
    expect(second).toBe(first);
    expect(db.entries.filter((e) => e.type === 'SPEND')).toHaveLength(1);
    expect(await repository.balance(ORG)).toBe(775);
  });

  it('charges again as <chargeKey>#2 after the first charge was refunded', async () => {
    const { repository, service } = setup();
    await credit(repository, 1000);
    await spendPost(repository, 225);
    await service.refund('post:p1#1');
    const again = await spendPost(repository, 225);
    expect(again.idempotencyKey).toBe('post:p1#2');
    expect(await repository.balance(ORG)).toBe(775);
  });

  it('throws InsufficientCreditsError with needed and balance when the balance is short', async () => {
    const { repository, db } = setup();
    await credit(repository, 100);
    const err = await spendPost(repository, 225).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.needed).toBe(225);
    expect(err.balance).toBe(100);
    expect(db.entries.filter((e) => e.type === 'SPEND')).toHaveLength(0);
  });

  it('charges an exact balance down to zero', async () => {
    const { repository } = setup();
    await credit(repository, 225);
    await spendPost(repository, 225);
    expect(await repository.balance(ORG)).toBe(0);
  });

  it('charges into a negative balance with allowNegative', async () => {
    const { repository } = setup();
    await credit(repository, 100);
    const entry = await spendPost(repository, 5000, {
      allowNegative: true,
      chargeKey: 'storage:2026-10',
    });
    expect(entry.amount).toBe(-5000);
    expect(await repository.balance(ORG)).toBe(-4900);
  });

  it('keeps different chargeKeys independent', async () => {
    const { repository } = setup();
    await credit(repository, 1000);
    const a = await spendPost(repository, 225, { chargeKey: 'post:a' });
    const b = await spendPost(repository, 225, { chargeKey: 'post:b' });
    expect(a.idempotencyKey).toBe('post:a#1');
    expect(b.idempotencyKey).toBe('post:b#1');
    expect(await repository.balance(ORG)).toBe(550);
  });
});

describe('WalletRepository.add', () => {
  it('returns the first entry when the idempotency key repeats', async () => {
    const { repository, db } = setup();
    const a = await credit(repository, 500, 'same');
    const b = await credit(repository, 500, 'same');
    expect(b).toBe(a);
    expect(db.entries).toHaveLength(1);
  });

  it('rethrows a duplicate when the entry has no idempotency key', async () => {
    const { repository, db } = setup();
    db.model.walletEntry.create = async () => {
      throw Object.assign(new Error('dup'), { code: 'P2002' });
    };
    await expect(
      repository.add({
        organizationId: ORG,
        amount: 1,
        type: 'GRANT',
        description: 'x',
      })
    ).rejects.toThrow('dup');
  });
});

describe('WalletService.refund', () => {
  it('gives a charge back once, however often it is called', async () => {
    const { repository, service, db } = setup();
    await credit(repository, 1000);
    await spendPost(repository, 225);
    const first = await service.refund('post:p1#1', 'X rejected the post');
    const second = await service.refund('post:p1#1');
    expect(first.amount).toBe(225);
    expect(first.type).toBe('REFUND');
    expect(first.idempotencyKey).toBe('refund:post:p1#1');
    expect(first.description).toBe('X rejected the post');
    expect(second).toBe(first);
    expect(db.entries.filter((e) => e.type === 'REFUND')).toHaveLength(1);
    expect(await repository.balance(ORG)).toBe(1000);
  });

  it('does nothing when the charge does not exist', async () => {
    const { service, db } = setup();
    expect(await service.refund('post:missing#1')).toBeUndefined();
    expect(db.entries).toHaveLength(0);
  });

  it('does not refund an entry that was not a charge', async () => {
    const { repository, service } = setup();
    await credit(repository, 1000, 'grant-1');
    expect(await service.refund('grant-1')).toBeUndefined();
    expect(await repository.balance(ORG)).toBe(1000);
  });
});

describe('WalletService.addTopUp', () => {
  const topUp = (service: WalletService, paymentIntentId = 'pi_1') =>
    service.addTopUp({
      organizationId: ORG,
      amount: 1000,
      credits: 100000,
      currency: 'usd',
      auto: false,
      paymentIntentId,
    });

  it('credits a payment intent once, however often the webhook repeats', async () => {
    const { service, repository, db } = setup();
    const a = await topUp(service);
    const b = await topUp(service);
    expect(b).toBe(a);
    expect(a.idempotencyKey).toBe('topup:pi_1');
    expect(a.type).toBe('TOPUP');
    expect(a.currency).toBe('USD');
    expect(db.entries).toHaveLength(1);
    expect(await repository.balance(ORG)).toBe(100000);
  });

  it('starts pay-as-you-go on the first top-up and keeps that date afterwards', async () => {
    const { service, db } = setup();
    await topUp(service, 'pi_1');
    const started = db.wallets[0].firstTopUpAt;
    expect(started).toBeInstanceOf(Date);
    expect(db.wallets[0].currency).toBe('USD');
    expect(await service.isPayAsYouGo(ORG)).toBe(true);

    await topUp(service, 'pi_2');
    expect(db.wallets[0].firstTopUpAt).toBe(started);
    expect(db.model.wallet.update).toHaveBeenCalledTimes(1);
  });

  it('records an automatic top-up as AUTO_TOPUP', async () => {
    const { service } = setup();
    const entry = await service.addTopUp({
      organizationId: ORG,
      amount: 1000,
      credits: 100000,
      currency: 'USD',
      auto: true,
      paymentIntentId: 'pi_auto',
    });
    expect(entry.type).toBe('AUTO_TOPUP');
    expect(entry.paidAmount).toBe(1000);
  });
});

describe('WalletService.clawBack', () => {
  const topUp = async (service: WalletService) =>
    service.addTopUp({
      organizationId: ORG,
      amount: 1000,
      credits: 100000,
      currency: 'USD',
      auto: false,
      paymentIntentId: 'pi_1',
    });

  it('takes back the refunded share and freezes the wallet', async () => {
    const { service, repository, db } = setup();
    await topUp(service);
    const result = await service.clawBack({
      paymentIntentId: 'pi_1',
      share: 0.5,
      eventKey: 'refund:500',
      description: 'Payment refunded',
    });
    expect(result.credits).toBe(50000);
    expect(await repository.balance(ORG)).toBe(50000);
    expect(db.wallets[0].frozenAt).toBeInstanceOf(Date);
    expect(db.wallets[0].autoTopUp).toBe(false);
    expect(await service.isPayAsYouGo(ORG)).toBe(false);
  });

  it('never takes back more than was credited when a partial refund is followed by a dispute', async () => {
    const { service, repository } = setup();
    await topUp(service);
    await service.clawBack({
      paymentIntentId: 'pi_1',
      share: 0.3,
      eventKey: 'refund:300',
      description: 'Payment refunded',
    });
    const dispute = await service.clawBack({
      paymentIntentId: 'pi_1',
      share: 1,
      eventKey: 'dispute:dp_1',
      description: 'Payment disputed',
    });
    expect(dispute.credits).toBe(70000);
    expect(await repository.balance(ORG)).toBe(0);

    const again = await service.clawBack({
      paymentIntentId: 'pi_1',
      share: 1,
      eventKey: 'dispute:dp_2',
      description: 'Payment disputed',
    });
    expect(again.credits).toBe(0);
    expect(again.entry).toBeUndefined();
    expect(await repository.balance(ORG)).toBe(0);
  });

  it('writes a repeated Stripe event only once', async () => {
    const { service, repository } = setup();
    await topUp(service);
    const params = {
      paymentIntentId: 'pi_1',
      share: 0.5,
      eventKey: 'refund:500',
      description: 'Payment refunded',
    };
    await service.clawBack(params);
    await service.clawBack(params);
    expect(await repository.balance(ORG)).toBe(50000);
  });

  it('can take the balance below zero when the credits were already spent', async () => {
    const { service, repository } = setup();
    await topUp(service);
    await spendPost(repository, 90000);
    await service.clawBack({
      paymentIntentId: 'pi_1',
      share: 1,
      eventKey: 'dispute:dp_1',
      description: 'Payment disputed',
    });
    expect(await repository.balance(ORG)).toBe(-90000);
  });

  it('returns undefined for a payment that never credited this ledger', async () => {
    const { service, db } = setup();
    expect(
      await service.clawBack({
        paymentIntentId: 'pi_unknown',
        share: 1,
        eventKey: 'dispute:dp_1',
        description: 'Payment disputed',
      })
    ).toBeUndefined();
    expect(db.entries).toHaveLength(0);
  });
});
