jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert',
  () => ({ walletAlert: jest.fn(async () => undefined) })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import { AdminStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { WalletPlusService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service';
import { PLUS } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';

// The money side of the growth dashboard against mocked Prisma models: the
// rows below stand in for the tables, and each groupBy / findMany answers
// from them the way the database would for the where it is given.

const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
const future = new Date(now + 10 * DAY);

const wallet = (organizationId: string, data: Record<string, any> = {}) => ({
  organizationId,
  createdAt: ago(60),
  firstTopUpAt: null,
  frozenAt: null,
  welcomeCreditsSkippedAt: null,
  plusSubscriptionId: null,
  plusStatus: null,
  plusInterval: null,
  plusPeriodEnd: null,
  plusCancelAt: null,
  plusPaidPeriodStart: null,
  plusEarlyBirdCodeId: null,
  ...data,
});

const entry = (
  organizationId: string,
  type: string,
  amount: number,
  data: Record<string, any> = {}
) => ({
  organizationId,
  type,
  amount,
  actionKey: null,
  currency: null,
  paidAmount: null,
  idempotencyKey: null,
  createdAt: ago(1),
  ...data,
});

// Just enough of Prisma's where to answer the queries getGrowthMoney makes.
const matches = (row: any, where: any = {}): boolean =>
  Object.entries(where).every(([key, condition]: [string, any]) => {
    const value = row[key];
    if (condition === null || typeof condition !== 'object') {
      return value === condition;
    }
    if (condition instanceof Date) {
      return value?.getTime() === condition.getTime();
    }
    return Object.entries(condition).every(([op, arg]: [string, any]) => {
      switch (op) {
        case 'in':
          return arg.includes(value);
        case 'not':
          return value !== arg;
        case 'lt':
          return value < arg;
        case 'gte':
          return value >= arg;
        case 'startsWith':
          return typeof value === 'string' && value.startsWith(arg);
        default:
          throw new Error(`Unhandled operator ${op}`);
      }
    });
  });

const groupBy = (rows: any[]) =>
  jest.fn(async (args: any) => {
    const groups = new Map<string, any[]>();
    for (const row of rows.filter((r) => matches(r, args.where))) {
      const key = JSON.stringify(args.by.map((k: string) => row[k]));
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    return Array.from(groups.values()).map((group) => {
      const out: any = {};
      for (const k of args.by) {
        out[k] = group[0][k];
      }
      if (args._sum) {
        out._sum = {};
        for (const k of Object.keys(args._sum)) {
          out._sum[k] = group.some((r) => r[k] !== null)
            ? group.reduce((s, r) => s + (r[k] || 0), 0)
            : null;
        }
      }
      if (args._count) {
        out._count = { _all: group.length };
      }
      return out;
    });
  });

const setup = (data: { users: any[]; wallets: any[]; entries: any[] }) => {
  const walletEntry = {
    findMany: jest.fn(async (args: any) =>
      data.entries.filter((e) => matches(e, args.where))
    ),
    groupBy: groupBy(data.entries),
  };
  const user = {
    findMany: jest.fn(async () =>
      data.users.map((u) => ({
        createdAt: u.createdAt,
        organizations: u.owns.map((organizationId: string) => ({
          organizationId,
        })),
      }))
    ),
  };
  const model = (m: any) => ({ model: m } as any);
  const repository = new AdminStatsRepository(
    model({}),
    model({}),
    model({}),
    model({}),
    model({}),
    model({}),
    model({}),
    model({ user }),
    model({ wallet: { findMany: jest.fn(async () => data.wallets) } }),
    model({ walletEntry })
  );
  return { repository, user, walletEntry };
};

const subscribed = (organizationId: string, data: Record<string, any> = {}) =>
  wallet(organizationId, {
    plusSubscriptionId: `sub_${organizationId}`,
    plusStatus: 'active',
    plusInterval: 'month',
    plusPeriodEnd: future,
    plusPaidPeriodStart: ago(5),
    ...data,
  });

describe('AdminStatsRepository.getGrowthMoney', () => {
  it('counts the welcome credits claim by its welcome:<org> grant, and a skip only without one', async () => {
    const { repository, user } = setup({
      users: [
        { createdAt: ago(1), owns: ['a'] },
        { createdAt: ago(1), owns: ['b'] },
        { createdAt: ago(1), owns: ['c'] },
        { createdAt: ago(1), owns: ['d'] },
      ],
      wallets: [
        wallet('a'),
        wallet('b', { welcomeCreditsSkippedAt: ago(1) }),
        wallet('c'),
        wallet('d'),
      ],
      entries: [
        entry('a', 'GRANT', 10000, { idempotencyKey: 'welcome:a' }),
        // An admin grant, and another workspace's key: neither is a claim.
        entry('c', 'GRANT', 5000, { idempotencyKey: 'grant:1' }),
        entry('d', 'GRANT', 10000, { idempotencyKey: 'welcome:a2' }),
      ],
    });
    const money = await repository.getGrowthMoney();
    const row = money.funnel.find((r) => r.window === '7d')!;
    expect(row.signups).toBe(4);
    expect(row.claimedCredits).toBe(1);
    expect(row.skippedCredits).toBe(1);
    expect(money.credits.find((r) => r.window === '7d')!.welcome).toBe(100);
    // Only the workspaces the person owns count
    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          organizations: expect.objectContaining({
            where: { role: { in: ['ADMIN', 'SUPERADMIN'] } },
          }),
        }),
      })
    );
  });

  it('counts a spend as a charge that took credits, not expiry or a clawback', async () => {
    const { repository } = setup({
      users: [
        { createdAt: ago(1), owns: ['a'] },
        { createdAt: ago(1), owns: ['b'] },
        { createdAt: ago(1), owns: ['c'] },
      ],
      wallets: [wallet('a'), wallet('b'), wallet('c')],
      entries: [
        entry('a', 'SPEND', -225, { actionKey: 'x.post' }),
        entry('b', 'PLAN_EXPIRE', -4000),
        entry('b', 'ADJUST', -1000, { idempotencyKey: 'chargeback:pi_1:e1' }),
        // A free use costs nothing, so it is not a spend.
        entry('c', 'SPEND', 0, { actionKey: 'x.post' }),
      ],
    });
    const money = await repository.getGrowthMoney();
    const row = money.funnel.find((r) => r.window === 'all')!;
    expect(row.spentCredits).toBe(1);
    const credits = money.credits.find((r) => r.window === 'all')!;
    expect(credits.spent).toBe(2.25);
    expect(credits.expired).toBe(40);
  });

  it('counts Plus as subscribed once it was ever on, split by interval, and active now', async () => {
    const { repository } = setup({
      users: [
        { createdAt: ago(1), owns: ['paid'] },
        { createdAt: ago(1), owns: ['ended'] },
        { createdAt: ago(1), owns: ['never-paid'] },
        { createdAt: ago(1), owns: ['granted'] },
        { createdAt: ago(1), owns: [] },
      ],
      wallets: [
        subscribed('paid'),
        // Ended, but it was on: it still counts as having subscribed.
        subscribed('ended', {
          plusStatus: 'canceled',
          plusInterval: 'year',
          plusPeriodEnd: ago(2),
        }),
        // Checkout never paid: not subscribed.
        subscribed('never-paid', {
          plusStatus: 'incomplete',
          plusPaidPeriodStart: null,
        }),
        // Not paid this span yet, but it released plan credits before.
        subscribed('granted', {
          plusStatus: 'past_due',
          plusPaidPeriodStart: null,
        }),
      ],
      entries: [entry('granted', 'PLAN_GRANT', 40000)],
    });
    const money = await repository.getGrowthMoney();
    const row = money.funnel.find((r) => r.window === '7d')!;
    expect(row.signups).toBe(5);
    expect(row.subscribed).toBe(3);
    expect(row.subscribedMonthly).toBe(2);
    expect(row.subscribedAnnual).toBe(1);
    expect(row.subscribedNow).toBe(1);
    expect(money.plus).toMatchObject({
      active: 1,
      monthly: 1,
      annual: 0,
      // past_due after being paid; an incomplete first payment is not
      pastDue: 1,
      subscriptions: [{ subscriptionId: 'sub_paid', interval: 'month' }],
    });
  });

  it('counts early-bird codes by when the early bird started, and the ones that subscribed', async () => {
    const { repository } = setup({
      users: [],
      wallets: [
        subscribed('a', { plusEarlyBirdCodeId: 'promo_a' }),
        wallet('b', { plusEarlyBirdCodeId: 'promo_b' }),
        wallet('c', {
          plusEarlyBirdCodeId: 'promo_c',
          welcomeCreditsSkippedAt: ago(20),
        }),
        wallet('d'),
      ],
      entries: [
        entry('a', 'GRANT', 10000, {
          idempotencyKey: 'welcome:a',
          createdAt: ago(3),
        }),
        entry('b', 'GRANT', 10000, {
          idempotencyKey: 'welcome:b',
          createdAt: ago(3),
        }),
      ],
    });
    const money = await repository.getGrowthMoney();
    expect(money.earlyBird).toEqual([
      { window: '24h', issued: 0, converted: 0 },
      { window: '7d', issued: 2, converted: 1 },
      { window: '30d', issued: 3, converted: 1 },
      { window: 'all', issued: 3, converted: 1 },
    ]);
  });

  it('adds up grants, top-up revenue, legacy pay-as-you-go and the top actions', async () => {
    const launch = ago(10);
    const { repository } = setup({
      users: [],
      wallets: [
        wallet('old', { firstTopUpAt: ago(30) }),
        subscribed('old-plus', { firstTopUpAt: ago(40) }),
        wallet('old-frozen', { firstTopUpAt: ago(40), frozenAt: ago(1) }),
        wallet('new', { firstTopUpAt: ago(5) }),
      ],
      entries: [
        entry('old', 'TOPUP', 20000, { paidAmount: 1000, currency: 'usd' }),
        entry('new', 'AUTO_TOPUP', 20000, { paidAmount: 1000, currency: 'USD' }),
        entry('old-plus', 'PLAN_GRANT', 40000),
        entry('old', 'SPEND', -600, { actionKey: 'x.post', createdAt: ago(2) }),
        entry('old', 'SPEND', -600, { actionKey: 'x.post', createdAt: ago(40) }),
        entry('old', 'REFUND', 600, { actionKey: 'x.post', createdAt: ago(2) }),
        entry('new', 'SPEND', -100, { actionKey: 'ai.image', createdAt: ago(2) }),
      ],
    });
    const money = await repository.getGrowthMoney(launch);
    expect(money.credits.find((r) => r.window === '7d')).toEqual({
      window: '7d',
      welcome: 0,
      plan: 400,
      topUp: 400,
      spent: 1,
      expired: 0,
      topUpRevenue: [{ currency: 'USD', amount: 2000 }],
    });
    expect(money.legacy).toEqual({
      total: 3,
      open: 1,
      onPlus: 1,
      spentLast30d: 1,
    });
    expect(money.topActions).toEqual([
      {
        actionKey: 'ai.image',
        monthly: { credits: 1, charges: 1 },
        allTime: { credits: 1, charges: 1 },
      },
      {
        actionKey: 'x.post',
        monthly: { credits: 0, charges: 1 },
        allTime: { credits: 6, charges: 2 },
      },
    ]);
  });
});

describe('AdminStatsRepository growth sign-up funnel', () => {
  it('ends onboarding with the welcome credits claim or skip, read like the money funnel', async () => {
    const $queryRaw = jest.fn(async (_strings: TemplateStringsArray) => [
      {
        window: '7d',
        signups: BigInt(10),
        activated: BigInt(9),
        onboarded: BigInt(8),
        channelConnected: BigInt(7),
        mcpConnected: BigInt(6),
        claimedCredits: BigInt(4),
        skippedCredits: BigInt(1),
        scheduledPost: BigInt(3),
        toppedUp: BigInt(2),
      },
    ]);
    const model = (m: any) => ({ model: m } as any);
    const repository = new AdminStatsRepository(
      model({ $queryRaw }),
      model({}),
      model({}),
      model({}),
      model({}),
      model({}),
      model({}),
      model({}),
      model({}),
      model({})
    );
    const funnel = await (repository as any).growthFunnel({
      '24h': ago(1),
      '7d': ago(7),
      '30d': ago(30),
      all: new Date(0),
    });
    expect(funnel.find((r: any) => r.window === '7d')).toEqual({
      window: '7d',
      signups: 10,
      activated: 9,
      onboarded: 8,
      channelConnected: 7,
      mcpConnected: 6,
      claimedCredits: 4,
      skippedCredits: 1,
      scheduledPost: 3,
      toppedUp: 2,
    });
    expect(funnel.find((r: any) => r.window === '24h').claimedCredits).toBe(0);
    // The claim is the grant keyed welcome:<its own organization>, and a skip
    // counts only without one.
    const sql = ($queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain(`w."idempotencyKey" = 'welcome:' || o."organizationId"`);
    expect(sql).toContain('wa."welcomeCreditsSkippedAt" IS NOT NULL');
    expect(sql).not.toContain('tutorial');
  });
});

describe('WalletPlusService.subscriptionPrices', () => {
  const key = process.env.WALLET_STRIPE_SECRET_KEY;
  beforeAll(() => {
    process.env.WALLET_STRIPE_SECRET_KEY = 'sk_test';
  });
  afterAll(() => {
    process.env.WALLET_STRIPE_SECRET_KEY = key;
  });

  const service = (subscriptions: Record<string, any>) =>
    new WalletPlusService(
      {} as any,
      {
        stripe: {
          subscriptions: {
            retrieve: jest.fn(async (id: string) => {
              if (!subscriptions[id]) {
                throw new Error('No such subscription');
              }
              return subscriptions[id];
            }),
          },
        },
      } as any,
      {} as any,
      {} as any,
      {} as any
    );

  const sub = (amount: number, interval: string, discounts: any[] = [], quantity = 1) => ({
    items: {
      data: [{ quantity, price: { unit_amount: amount, currency: 'usd', recurring: { interval } } }],
    },
    discounts,
  });
  const coupon = (c: Record<string, any>) => ({
    source: { coupon: { duration: 'forever', ...c } },
  });

  it('reads what each bills from now on, and marks one a lasting discount takes all of as comped', async () => {
    const prices = await service({
      sub_full: sub(1900, 'month'),
      // The early bird is once: the next periods bill in full.
      sub_early: sub(1900, 'month', [coupon({ percent_off: 10, duration: 'once' })]),
      sub_free_once: sub(1900, 'month', [coupon({ percent_off: 100, duration: 'once' })]),
      sub_half: sub(19000, 'year', [coupon({ percent_off: 50 })]),
      sub_free: sub(19000, 'year', [coupon({ percent_off: 100 })]),
      sub_amount: sub(1900, 'month', [coupon({ amount_off: 1900, duration: 'repeating' })]),
      sub_two: sub(1900, 'month', [], 2),
    }).subscriptionPrices([
      'sub_full', 'sub_early', 'sub_free_once', 'sub_half', 'sub_free', 'sub_amount', 'sub_two', 'sub_gone',
    ]);
    const month = { currency: 'USD', interval: 'month' };
    const year = { currency: 'USD', interval: 'year' };
    expect(Object.fromEntries(prices)).toEqual({
      sub_full: { ...month, amount: 1900, comped: false },
      sub_early: { ...month, amount: 1900, comped: false },
      sub_free_once: { ...month, amount: 1900, comped: false },
      sub_half: { ...year, amount: 9500, comped: false },
      sub_free: { ...year, amount: 0, comped: true },
      sub_amount: { ...month, amount: 0, comped: true },
      sub_two: { ...month, amount: 3800, comped: false },
    });
  });
});

describe('AdminStatsService growth MRR', () => {
  const rows = (subscriptions: any[]) => ({
    funnel: [],
    plus: {
      active: subscriptions.length,
      monthly: 0,
      annual: 0,
      cancelling: 0,
      pastDue: 0,
      subscriptions,
    },
    earlyBird: [],
    credits: [],
    legacy: { total: 0, open: 0, onPlus: 0, spentLast30d: 0 },
    topActions: [{ actionKey: 'x.post', monthly: { credits: 1, charges: 1 }, allTime: { credits: 1, charges: 1 } }],
  });

  const service = (subscriptions: any[], prices: Record<string, any>) => {
    const repository = {
      getGrowth: jest.fn(async () => ({ generatedAt: 'now' })),
      getGrowthMoney: jest.fn(async () => rows(subscriptions)),
    };
    const wallet = {
      plusLaunchAt: jest.fn(async () => undefined),
      settings: jest.fn(async () => ({
        [PLUS.monthlyPrice]: '1900',
        [PLUS.annualPrice]: '18000',
      })),
      currency: jest.fn(async () => 'USD'),
      actions: jest.fn(async () => [{ key: 'x.post', name: 'Post on X' }]),
    };
    const plus = {
      subscriptionPrices: jest.fn(async () => new Map(Object.entries(prices))),
    };
    return new AdminStatsService(repository as any, wallet as any, plus as any);
  };

  it('adds monthly prices and a twelfth of annual ones, leaving comped ones out', async () => {
    const growth = await service(
      [
        { subscriptionId: 'm', interval: 'month' },
        { subscriptionId: 'y', interval: 'year' },
        { subscriptionId: 'free', interval: 'year' },
      ],
      {
        m: { amount: 1710, currency: 'USD', interval: 'month', comped: false },
        y: { amount: 24000, currency: 'USD', interval: 'year', comped: false },
        free: { amount: 19000, currency: 'USD', interval: 'year', comped: true },
      }
    ).getGrowth();
    expect(growth.money.plus).toMatchObject({
      comped: 1,
      mrr: [{ currency: 'USD', amount: 3710 }],
      mrrSource: 'stripe',
    });
    expect(growth.money.topActions[0].name).toBe('Post on X');
    expect(growth.generatedAt).toBe('now');
  });

  it('prices a subscription Stripe could not return from the settings', async () => {
    const growth = await service(
      [
        { subscriptionId: 'm', interval: 'month' },
        { subscriptionId: 'y', interval: 'year' },
      ],
      {}
    ).getGrowth();
    expect(growth.money.plus).toMatchObject({
      comped: 0,
      mrr: [{ currency: 'USD', amount: 3400 }],
      mrrSource: 'settings',
    });
  });
});
