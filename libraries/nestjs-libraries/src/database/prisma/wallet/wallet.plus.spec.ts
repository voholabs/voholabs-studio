jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert',
  () => ({ walletAlert: jest.fn(async () => undefined) })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import {
  BILLING,
  PLUS,
  PlusRequiredError,
  WalletService,
  planPeriods,
  plusIsActive,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { WalletBillingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import {
  PlusExistsError,
  PlusUnavailableError,
  WalletPlusService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';
import { WalletHousekeepingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.housekeeping.service';

// Plus against an in-memory ledger and a stub Stripe client: every number
// comes from the settings below, and nothing leaves the process.

const DAY = 86_400_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const T0 = new Date('2026-11-01T00:00:00.000Z');

const SETTINGS: Record<string, string> = {
  [BILLING.currency]: 'USD',
  [BILLING.creditsPerUnit]: '19',
  [BILLING.defaultMultiplierBp]: '15789',
  [BILLING.minTopUp]: '1000',
  [BILLING.signupCredits]: '100',
  [PLUS.monthlyPrice]: '1900',
  [PLUS.annualPrice]: '19000',
  [PLUS.credits]: '400',
  [PLUS.periodDays]: '30',
  [PLUS.earlyBirdPercent]: '10',
  [PLUS.earlyBirdMinutes]: '60',
  [PLUS.earlyBirdExtensionHours]: '24',
  [PLUS.earlyBirdEmail]: 'on',
};

const ACTIONS = [
  {
    key: 'x.post',
    provider: 'x',
    category: 'channels',
    name: 'Post on X',
    unit: 'post',
    costMicros: 15000,
    costCurrency: 'USD',
    multiplierBp: null,
    fixedPrice: null,
    freeUnits: null,
    freePeriod: null,
    billing: 'PER_USE',
    requiresTopUp: true,
    active: true,
  },
  {
    key: 'data.run',
    provider: 'data',
    category: 'research',
    name: 'Research data',
    unit: 'run',
    costMicros: 1_000_000,
    costCurrency: 'USD',
    multiplierBp: null,
    fixedPrice: null,
    freeUnits: null,
    freePeriod: null,
    billing: 'PER_USE',
    requiresTopUp: true,
    active: true,
  },
  {
    key: 'ai.image',
    provider: 'ai',
    category: 'ai',
    name: 'AI image',
    unit: 'image',
    costMicros: 40000,
    costCurrency: 'USD',
    multiplierBp: null,
    fixedPrice: null,
    freeUnits: null,
    freePeriod: null,
    billing: 'PER_USE',
    requiresTopUp: false,
    active: true,
  },
];

// A ledger and a wallet row in memory, with the repository's methods.
const ledger = (settings: Record<string, string> = SETTINGS) => {
  const entries: any[] = [];
  let wallet: any = null;
  const sum = (filter: (e: any) => boolean) =>
    entries.filter(filter).reduce((s, e) => s + e.amount, 0);
  const add = (entry: any) => {
    const row = { id: `e${entries.length + 1}`, createdAt: new Date(), ...entry };
    entries.push(row);
    return row;
  };
  const repo = {
    settings: jest.fn(async () =>
      Object.entries(settings).map(([key, value]) => ({ key, value }))
    ),
    actions: jest.fn(async () => ACTIONS),
    categories: jest.fn(async () => []),
    getWallet: jest.fn(async () => wallet),
    getWalletByCustomer: jest.fn(async (id: string) =>
      wallet?.stripeCustomerId === id ? wallet : null
    ),
    ensureWallet: jest.fn(async (organizationId: string) => {
      wallet ||= { organizationId, frozenAt: null, firstTopUpAt: null };
      return wallet;
    }),
    updateWallet: jest.fn(async (_org: string, data: any) => {
      wallet = { ...(wallet || {}), ...data };
      return wallet;
    }),
    balance: jest.fn(async () => sum(() => true)),
    balanceBefore: jest.fn(async (_org: string, at: Date) =>
      sum((e) => e.createdAt.getTime() < at.getTime())
    ),
    // The spends in [from, to), less their own refunds made before `to`.
    spentBetween: jest.fn(async (_org: string, from: Date, to: Date) => {
      const inside = (e: any) =>
        e.createdAt.getTime() >= from.getTime() &&
        e.createdAt.getTime() < to.getTime();
      const spends = entries.filter((e) => e.type === 'SPEND' && inside(e));
      const keys = new Set(
        spends.filter((e) => e.idempotencyKey).map((e) => `refund:${e.idempotencyKey}`)
      );
      return -(
        spends.reduce((s, e) => s + e.amount, 0) +
        sum(
          (e) =>
            e.type === 'REFUND' &&
            keys.has(e.idempotencyKey) &&
            e.createdAt.getTime() < to.getTime()
        )
      );
    }),
    planGrants: jest.fn(async () =>
      entries.filter((e) => e.type === 'PLAN_GRANT')
    ),
    entriesByKeys: jest.fn(async (keys: string[]) =>
      entries.filter((e) => keys.includes(e.idempotencyKey))
    ),
    entryByKey: jest.fn(
      async (key: string) => entries.find((e) => e.idempotencyKey === key) || null
    ),
    addOnce: jest.fn(async (entry: any) => {
      const found = entries.find(
        (e) => entry.idempotencyKey && e.idempotencyKey === entry.idempotencyKey
      );
      return found
        ? { entry: found, created: false }
        : { entry: add(entry), created: true };
    }),
    add: jest.fn(async (entry: any) => add(entry)),
    spend: jest.fn(async (entry: any) => {
      const { chargeKey, allowNegative, free, ...data } = entry;
      if (!allowNegative && sum(() => true) < data.amount) {
        throw new Error('Not enough credits');
      }
      return add({ ...data, chargeKey, amount: -data.amount });
    }),
    autoTopUpSpentSince: jest.fn(async () => 0),
    clawedBack: jest.fn(async (_org: string, paymentIntentId: string) =>
      sum((e) => e.type === 'ADJUST' && e.reference === paymentIntentId)
    ),
    plusWallets: jest.fn(async () =>
      wallet?.plusSubscriptionId ? [{ ...wallet, organizationId: 'org-1' }] : []
    ),
    adminEmails: jest.fn(async () => ['admin@example.com']),
    claimEarlyBirdEmail: jest.fn(async () => {
      if (wallet?.plusEarlyBirdEmailAt) return false;
      wallet = { ...(wallet || {}), plusEarlyBirdEmailAt: new Date() };
      return true;
    }),
    releaseEarlyBirdEmail: jest.fn(async () => {
      wallet = { ...(wallet || {}), plusEarlyBirdEmailAt: null };
    }),
    setEarlyBirdCode: jest.fn(async (_org: string, id: string, code: string) => {
      if (wallet?.plusEarlyBirdCodeId) return false;
      wallet = {
        ...(wallet || {}),
        plusEarlyBirdCodeId: id,
        plusEarlyBirdCode: code,
      };
      return true;
    }),
  };
  return {
    repo,
    entries,
    setWallet: (w: any) => (wallet = w && { organizationId: 'org-1', ...w }),
    row: () => wallet,
    add,
  };
};

// A card payment method on the wallet's Stripe customer.
const card = (id: string, over: Record<string, any> = {}) => ({
  id,
  type: 'card',
  customer: 'cus_1',
  card: { brand: 'visa', last4: id.slice(-4), exp_month: 12, exp_year: 2030 },
  ...over,
});

const stubStripe = (subscription: () => any) => ({
  coupons: { create: jest.fn(async () => ({ id: 'coupon_1' })) },
  promotionCodes: {
    create: jest.fn(async (params: any) => ({ id: 'promo_1', code: params.code })),
    update: jest.fn(async () => ({})),
    list: jest.fn(async () => ({ data: [] as any[] })),
  },
  checkout: {
    sessions: {
      create: jest.fn(async () => ({ url: 'https://stripe.test/cs_1' })),
      retrieve: jest.fn(async () => ({
        metadata: { service: 'wallet', kind: 'plus', organizationId: 'org-1' },
        subscription: 'sub_1',
      })),
    },
  },
  subscriptions: {
    retrieve: jest.fn(async () => subscription()),
    update: jest.fn(async () => ({})),
    cancel: jest.fn(async () => ({})),
  },
  // No payment is a top-up's unless a test says so.
  paymentIntents: {
    retrieve: jest.fn(async (id: string) => ({ id, status: 'succeeded', metadata: {} })),
  },
  invoicePayments: { list: jest.fn(async () => ({ data: [] as any[] })) },
  customers: {
    create: jest.fn(async () => ({ id: 'cus_1' })),
    retrieve: jest.fn(async () => ({
      id: 'cus_1',
      invoice_settings: { default_payment_method: null },
    })),
    update: jest.fn(async () => ({})),
  },
  // Cards on the wallet's customer, unless a test says otherwise.
  paymentMethods: {
    retrieve: jest.fn(async (id: string) => card(id)),
    attach: jest.fn(async (id: string) => card(id)),
  },
  billingPortal: {
    sessions: {
      create: jest.fn(async () => ({ url: 'https://stripe.test/portal' })),
    },
  },
});

// The invoice of the span starting at `start` (unix seconds), as the
// subscription's expanded latest_invoice.
const invoiceOf = (start: number, status = 'paid') => ({
  id: `in_${start}`,
  status,
  period_end: start,
  lines: { data: [{ period: { start, end: start + 30 * 86_400 } }] },
});

// A Stripe subscription as retrieve returns it (latest_invoice expanded):
// by default its span's invoice is paid.
const subscription = (over: Record<string, any> = {}) => {
  const sub: Record<string, any> = baseSubscription(over);
  return 'latest_invoice' in over
    ? sub
    : {
        ...sub,
        latest_invoice: invoiceOf(sub.items.data[0].current_period_start),
      };
};
const baseSubscription = (over: Record<string, any> = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at: null,
  cancel_at_period_end: false,
  ended_at: null,
  metadata: {
    service: 'wallet',
    kind: 'plus',
    organizationId: 'org-1',
    interval: 'month',
    credits: '40000',
    periodDays: '30',
  },
  items: {
    data: [
      {
        current_period_start: Math.floor(T0.getTime() / 1000),
        current_period_end: Math.floor((T0.getTime() + 30 * DAY) / 1000),
        price: { recurring: { interval: 'month' } },
      },
    ],
  },
  ...over,
});

const build = (settings: Record<string, string> = SETTINGS) => {
  const memory = ledger(settings);
  const notifications = {
    inAppNotification: jest.fn(async () => undefined),
    sendEmail: jest.fn(async () => undefined),
  };
  const wallet = new WalletService(memory.repo as any, notifications as any);
  const billing = new WalletBillingService(wallet, notifications as any);
  let sub = subscription();
  const stripe = stubStripe(() => sub);
  (billing as any)._client = stripe;
  const workflowStart = jest.fn(async () => undefined);
  const temporal = {
    client: { getRawClient: () => ({ workflow: { start: workflowStart } }) },
  };
  const plus = new WalletPlusService(
    wallet,
    billing,
    memory.repo as any,
    notifications as any,
    temporal as any
  );
  return {
    ...memory,
    wallet,
    billing,
    plus,
    stripe,
    notifications,
    workflowStart,
    setSubscription: (s: any) => (sub = s),
  };
};

// The wallet row of a workspace with Plus over [start, start + days).
const plusWallet = (over: Record<string, any> = {}, start = T0, days = 30) => ({
  stripeCustomerId: 'cus_1',
  frozenAt: null,
  firstTopUpAt: null,
  plusSubscriptionId: 'sub_1',
  plusStatus: 'active',
  plusInterval: days > 31 ? 'year' : 'month',
  plusPeriodStart: start,
  plusPeriodEnd: new Date(start.getTime() + days * DAY),
  plusCancelAt: null,
  plusPaidPeriodStart: start,
  plusCredits: 40000,
  plusPeriodDays: 30,
  ...over,
});

const at = (date: Date | number) =>
  jest.setSystemTime(typeof date === 'number' ? date : date.getTime());

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  at(T0);
  process.env.WALLET_STRIPE_SECRET_KEY = 'sk_test_stub';
  process.env.FRONTEND_URL = 'https://studio.test';
  (walletAlert as jest.Mock).mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Plus offer, from the settings only', () => {
  it('builds both intervals, their releases and the saving from the settings', async () => {
    const { plus } = build();
    expect(await plus.offer()).toEqual({
      currency: 'USD',
      creditsPerPeriod: 400,
      periodDays: 30,
      topUpCreditsPerUnit: 19,
      intervals: [
        // 4.75c a credit against 5.26c in a top-up.
        // 400 / 19 = $21.05 as top-ups: 1 - 19 / 21.05 = 9.75%, shown as 9%.
        { interval: 'month', price: 1900, releases: 1, pricePerRelease: 1900, topUpPrice: 2105, savingPercent: 9 },
        // 12 releases of 400 credits for $190: 3.96c a credit.
        // 12 x $21.05 = $252.63 as top-ups: 24.8%, shown as 24%.
        { interval: 'year', price: 19000, releases: 12, pricePerRelease: 1583, topUpPrice: 25263, savingPercent: 24 },
      ],
    });
  });

  it('changes with every setting (nothing hardcoded)', async () => {
    const { plus } = build({
      ...SETTINGS,
      [PLUS.monthlyPrice]: '2500',
      [PLUS.annualPrice]: '24000',
      [PLUS.credits]: '1000',
      [PLUS.periodDays]: '15',
      [BILLING.creditsPerUnit]: '20',
      [BILLING.currency]: 'EUR',
    });
    const offer = await plus.offer();
    expect(offer).toMatchObject({
      currency: 'EUR',
      creditsPerPeriod: 1000,
      periodDays: 15,
      topUpCreditsPerUnit: 20,
    });
    expect(offer!.intervals).toEqual([
      expect.objectContaining({ interval: 'month', price: 2500, releases: 2 }),
      expect.objectContaining({ interval: 'year', price: 24000, releases: 24 }),
    ]);
  });

  it('compares with top-ups from the settings, rounding the percent down', async () => {
    const pct = async (over: Record<string, string>) =>
      (await build({ ...SETTINGS, ...over }).plus.offer())!.intervals.map(
        (i) => [i.topUpPrice, i.savingPercent]
      );
    // 400 credits at 20 a dollar = $20: $19 is exactly 5% cheaper.
    expect(await pct({ [BILLING.creditsPerUnit]: '20' })).toEqual([
      [2000, 5],
      [24000, 20],
    ]);
    // $18 against $21.05 is 14.5%: 14, never 15.
    expect(await pct({ [PLUS.monthlyPrice]: '1800' })).toEqual([
      [2105, 14],
      [25263, 24],
    ]);
    // An exact 10% stays 10%: $18 against $20.
    expect(
      await pct({ [BILLING.creditsPerUnit]: '20', [PLUS.monthlyPrice]: '1800' })
    ).toEqual([
      [2000, 10],
      [24000, 20],
    ]);
    // Dearer than top-ups is never shown as a saving.
    expect(await pct({ [PLUS.monthlyPrice]: '2500' })).toEqual([
      [2105, 0],
      [25263, 24],
    ]);
  });

  it('is not offered when a setting is missing or payments are off', async () => {
    for (const key of [PLUS.credits, PLUS.periodDays, BILLING.creditsPerUnit]) {
      const settings = { ...SETTINGS };
      delete settings[key];
      expect(await build(settings).plus.offer()).toBeNull();
    }
    const noPrices = { ...SETTINGS };
    delete noPrices[PLUS.monthlyPrice];
    delete noPrices[PLUS.annualPrice];
    expect(await build(noPrices).plus.offer()).toBeNull();

    const monthOnly = { ...SETTINGS };
    delete monthOnly[PLUS.annualPrice];
    expect(
      (await build(monthOnly).plus.offer())!.intervals.map((i) => i.interval)
    ).toEqual(['month']);

    delete process.env.WALLET_STRIPE_SECRET_KEY;
    expect(await build().plus.offer()).toBeNull();
  });
});

describe('Plus checkout', () => {
  it('prices the monthly and annual subscription from the settings', async () => {
    for (const [interval, amount] of [
      ['month', 1900],
      ['year', 19000],
    ] as const) {
      const { plus, stripe, setWallet } = build();
      setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
      await plus.createCheckout({
        organizationId: 'org-1',
        interval,
        returnUrl: 'https://studio.test/plus',
      });
      const params = (stripe.checkout.sessions.create as jest.Mock).mock
        .calls[0][0];
      expect(params.mode).toBe('subscription');
      expect(params.line_items[0].price_data).toMatchObject({
        currency: 'usd',
        unit_amount: amount,
        recurring: { interval },
      });
      expect(params.subscription_data.metadata).toMatchObject({
        kind: 'plus',
        organizationId: 'org-1',
        credits: '40000',
        periodDays: '30',
      });
      expect(params.discounts).toBeUndefined();
      // No early bird: a code can still be typed at Checkout.
      expect(params.allow_promotion_codes).toBe(true);
    }
  });

  it('refuses when Plus is not offered or already on', async () => {
    const settings = { ...SETTINGS };
    delete settings[PLUS.credits];
    const off = build(settings);
    off.setWallet({ stripeCustomerId: 'cus_1' });
    await expect(
      off.plus.createCheckout({ organizationId: 'org-1', interval: 'month', returnUrl: 'x' })
    ).rejects.toThrow(PlusUnavailableError);

    const on = build();
    on.setWallet(plusWallet());
    await expect(
      on.plus.createCheckout({ organizationId: 'org-1', interval: 'month', returnUrl: 'x' })
    ).rejects.toThrow('already has Plus');
  });
});

describe('Early bird', () => {
  const claimed = (b: ReturnType<typeof build>) => {
    b.add({ type: 'GRANT', amount: 10000, idempotencyKey: 'welcome:org-1' });
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
  };

  it('is valid for the first window, then the extension, then never again', async () => {
    const b = build();
    claimed(b);
    at(T0.getTime() + 59 * MINUTE);
    expect(await b.plus.earlyBird('org-1')).toEqual({
      percent: 10,
      expiresAt: new Date(T0.getTime() + 60 * MINUTE),
      extended: false,
      code: expect.stringMatching(/^ADMI-[A-Z2-9]{5}$/),
    });
    at(T0.getTime() + 61 * MINUTE);
    expect(await b.plus.earlyBird('org-1')).toMatchObject({
      extended: true,
      expiresAt: new Date(T0.getTime() + 60 * MINUTE + 24 * HOUR),
    });
    at(T0.getTime() + 60 * MINUTE + 24 * HOUR);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
    at(T0.getTime() + 30 * DAY);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
  });

  it('takes the windows from the settings', async () => {
    const b = build({
      ...SETTINGS,
      [PLUS.earlyBirdPercent]: '25',
      [PLUS.earlyBirdMinutes]: '10',
      [PLUS.earlyBirdExtensionHours]: '0',
    });
    claimed(b);
    at(T0.getTime() + 9 * MINUTE);
    expect(await b.plus.earlyBird('org-1')).toMatchObject({ percent: 25 });
    expect(b.stripe.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        percent_off: 25,
        redeem_by: Math.floor((T0.getTime() + 10 * MINUTE) / 1000),
      }),
      expect.anything()
    );
    // No extension: over at 10 minutes.
    at(T0.getTime() + 11 * MINUTE);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
  });

  it('needs the claim, and is not offered without its settings', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1' });
    expect(await b.plus.earlyBird('org-1')).toBeNull();
    const settings = { ...SETTINGS };
    delete settings[PLUS.earlyBirdPercent];
    const none = build(settings);
    claimed(none);
    expect(await none.plus.earlyBird('org-1')).toBeNull();
  });

  it('is a personal code: one Stripe promotion code for the workspace, once', async () => {
    const b = build();
    claimed(b);
    at(T0.getTime() + 5 * MINUTE);
    const first = await b.plus.earlyBird('org-1');
    const end = Math.floor((T0.getTime() + 60 * MINUTE + 24 * HOUR) / 1000);
    expect(b.stripe.coupons.create).toHaveBeenCalledWith(
      {
        percent_off: 10,
        duration: 'once',
        max_redemptions: 1,
        redeem_by: end,
        name: 'Early bird 10% off',
        metadata: { service: 'wallet', kind: 'plus_early_bird', organizationId: 'org-1' },
      },
      { idempotencyKey: `plus-early-bird-coupon:org-1:${T0.getTime()}:10:${end}` }
    );
    expect(b.stripe.promotionCodes.create).toHaveBeenCalledWith(
      {
        promotion: { type: 'coupon', coupon: 'coupon_1' },
        code: first!.code,
        // Only this workspace's Stripe customer, once, until the very end.
        customer: 'cus_1',
        max_redemptions: 1,
        expires_at: end,
        metadata: { service: 'wallet', kind: 'plus_early_bird', organizationId: 'org-1' },
      },
      { idempotencyKey: `plus-early-bird-code:org-1:${T0.getTime()}:10:${end}:coupon_1:cus_1` }
    );
    expect(b.row()).toMatchObject({
      plusEarlyBirdCodeId: 'promo_1',
      plusEarlyBirdCode: first!.code,
    });
    // Every later read, the extension and checkout re-use it.
    expect((await b.plus.earlyBird('org-1'))!.code).toBe(first!.code);
    at(T0.getTime() + 2 * HOUR);
    expect(await b.plus.earlyBird('org-1')).toMatchObject({
      extended: true,
      code: first!.code,
    });
    await b.plus.createCheckout({ organizationId: 'org-1', interval: 'month', returnUrl: 'x' });
    expect(b.stripe.coupons.create).toHaveBeenCalledTimes(1);
    expect(b.stripe.promotionCodes.create).toHaveBeenCalledTimes(1);
  });

  it('a code another call kept first is the one used', async () => {
    const b = build();
    claimed(b);
    (b.repo.setEarlyBirdCode as jest.Mock).mockImplementationOnce(async () => {
      b.setWallet({
        ...b.row(),
        plusEarlyBirdCodeId: 'promo_0',
        plusEarlyBirdCode: 'ADMI-FIRST',
      });
      return false;
    });
    expect((await b.plus.earlyBird('org-1'))!.code).toBe('ADMI-FIRST');
  });

  it('is shown without a code never: Stripe failing hides it, without throwing', async () => {
    const b = build();
    claimed(b);
    (b.stripe.promotionCodes.create as jest.Mock).mockRejectedValueOnce(
      new Error('Stripe is down')
    );
    expect(await b.plus.earlyBird('org-1')).toBeNull();
    // The next read makes it.
    expect(await b.plus.earlyBird('org-1')).toMatchObject({ percent: 10 });
  });

  it('a code that could not be made is logged and alerted, once', async () => {
    const b = build();
    claimed(b);
    (b.stripe.promotionCodes.create as jest.Mock).mockRejectedValue(
      new Error('Keys for idempotent requests can only be used with the same parameters')
    );
    expect(await b.plus.earlyBird('org-1')).toBeNull();
    expect(await b.plus.earlyBird('org-1')).toBeNull();
    expect(walletAlert).toHaveBeenCalledTimes(1);
    expect((walletAlert as jest.Mock).mock.calls[0][0]).toContain(
      'Early-bird code for org-1 could not be made'
    );
    // Made later: a new failure is alerted again.
    (b.stripe.promotionCodes.create as jest.Mock).mockImplementation(
      async (params: any) => ({ id: 'promo_1', code: params.code })
    );
    expect(await b.plus.earlyBird('org-1')).toMatchObject({ percent: 10 });
  });

  it('a Stripe customer that could not be made is alerted, not silent', async () => {
    const b = build();
    b.add({ type: 'GRANT', amount: 10000, idempotencyKey: 'welcome:org-1' });
    b.setWallet({ stripeCustomerId: null, frozenAt: null, updatedAt: T0 });
    (b.stripe.customers.create as jest.Mock).mockRejectedValueOnce(
      new Error('Keys for idempotent requests can only be used with the same parameters')
    );
    expect(await b.plus.earlyBird('org-1')).toBeNull();
    expect(walletAlert).toHaveBeenCalledWith(
      expect.stringContaining('Early-bird code for org-1 could not be made')
    );
    expect(b.stripe.promotionCodes.create).not.toHaveBeenCalled();
    // The next read makes the customer and the code.
    expect(await b.plus.earlyBird('org-1')).toMatchObject({ percent: 10 });
    expect(b.row().stripeCustomerId).toBe('cus_1');
  });

  it('takes the code Stripe already has when it was made but not kept', async () => {
    const b = build();
    claimed(b);
    (b.stripe.promotionCodes.create as jest.Mock).mockRejectedValueOnce(
      new Error('An active promotion code with this code already exists')
    );
    (b.stripe.promotionCodes.list as jest.Mock).mockResolvedValueOnce({
      data: [{ id: 'promo_9', code: 'ADMI-KEPT1' }],
    });
    expect((await b.plus.earlyBird('org-1'))!.code).toBe('ADMI-KEPT1');
    expect(b.stripe.promotionCodes.list).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', active: true })
    );
    expect(b.row().plusEarlyBirdCodeId).toBe('promo_9');
  });

  it('a settings change makes a new request to Stripe, not a refused repeat', async () => {
    const keys = async (percent: string) => {
      const b = build({ ...SETTINGS, [PLUS.earlyBirdPercent]: percent });
      claimed(b);
      await b.plus.earlyBird('org-1');
      return (b.stripe.coupons.create as jest.Mock).mock.calls[0][1]
        .idempotencyKey;
    };
    expect(await keys('10')).not.toBe(await keys('15'));
  });

  it('checks out without the code when Stripe refuses it', async () => {
    const b = build();
    claimed(b);
    (b.stripe.checkout.sessions.create as jest.Mock).mockRejectedValueOnce(
      new Error('This promotion code has expired')
    );
    const result = await b.plus.createCheckout({
      organizationId: 'org-1',
      interval: 'month',
      returnUrl: 'x',
    });
    expect(result.url).toBe('https://stripe.test/cs_1');
    const calls = (b.stripe.checkout.sessions.create as jest.Mock).mock.calls;
    expect(calls[0][0].discounts).toEqual([{ promotion_code: 'promo_1' }]);
    expect(calls[1][0].discounts).toBeUndefined();
    expect(calls[1][0].allow_promotion_codes).toBe(true);
    expect(calls[1][0].metadata.earlyBirdPercent).toBeUndefined();
  });

  it('reads like a name and the same every time for the workspace', () => {
    const { earlyBirdCodeText } = jest.requireActual(
      '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service'
    );
    const code = earlyBirdCodeText('org-1', T0, 'mehrdad.k@example.com');
    expect(code).toMatch(/^MEHR-[A-HJ-NP-Z2-9]{5}$/);
    expect(earlyBirdCodeText('org-1', T0, 'mehrdad.k@example.com')).toBe(code);
    expect(earlyBirdCodeText('org-2', T0, 'mehrdad.k@example.com')).not.toBe(code);
    expect(earlyBirdCodeText('org-1', T0, '42@example.com')).toMatch(/^PLUS-/);
  });

  it('applies the code at checkout while valid', async () => {
    const b = build();
    claimed(b);
    at(T0.getTime() + 30 * MINUTE);
    await b.plus.createCheckout({
      organizationId: 'org-1',
      interval: 'year',
      returnUrl: 'x',
    });
    const params = (b.stripe.checkout.sessions.create as jest.Mock).mock
      .calls[0][0];
    expect(params.discounts).toEqual([{ promotion_code: 'promo_1' }]);
    // Stripe takes one of the two.
    expect(params.allow_promotion_codes).toBeUndefined();
    // The session closes with the offer (Stripe's 30-minute minimum).
    expect(params.expires_at).toBe(
      Math.floor((T0.getTime() + 30 * MINUTE + 31 * MINUTE) / 1000)
    );
  });

  it('is refused at checkout once expired', async () => {
    const b = build();
    claimed(b);
    at(T0.getTime() + 60 * MINUTE + 24 * HOUR + 1);
    await b.plus.createCheckout({
      organizationId: 'org-1',
      interval: 'month',
      returnUrl: 'x',
    });
    expect(b.stripe.coupons.create).not.toHaveBeenCalled();
    expect(b.stripe.promotionCodes.create).not.toHaveBeenCalled();
    const params = (b.stripe.checkout.sessions.create as jest.Mock).mock
      .calls[0][0];
    expect(params.discounts).toBeUndefined();
    // A code typed now is refused by Stripe (it expired with the offer).
    expect(params.allow_promotion_codes).toBe(true);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
  });

  it('an expired code made earlier is neither shown nor applied', async () => {
    const b = build();
    claimed(b);
    await b.plus.earlyBird('org-1');
    at(T0.getTime() + 60 * MINUTE + 24 * HOUR);
    expect((await b.plus.plan('org-1')).earlyBird).toBeNull();
    await b.plus.createCheckout({ organizationId: 'org-1', interval: 'month', returnUrl: 'x' });
    const params = (b.stripe.checkout.sessions.create as jest.Mock).mock
      .calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
  });

  it('switches the code off once the first subscription is on record', async () => {
    const b = build();
    claimed(b);
    await b.plus.earlyBird('org-1');
    await b.plus.syncSubscription('sub_1');
    expect(b.stripe.promotionCodes.update).toHaveBeenCalledWith('promo_1', {
      active: false,
    });
    // Later events leave it.
    await b.plus.syncSubscription('sub_1');
    expect(b.stripe.promotionCodes.update).toHaveBeenCalledTimes(1);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
  });

  it('a failing switch-off never throws', async () => {
    const b = build();
    claimed(b);
    await b.plus.earlyBird('org-1');
    (b.stripe.promotionCodes.update as jest.Mock).mockRejectedValueOnce(
      new Error('Stripe is down')
    );
    await expect(b.plus.syncSubscription('sub_1')).resolves.toBeUndefined();
    expect(b.row().plusSubscriptionId).toBe('sub_1');
  });

  // Onboarding's last step skipped instead of claimed, at the current time.
  const skipped = (b: ReturnType<typeof build>, over: Record<string, any> = {}) =>
    b.setWallet({
      stripeCustomerId: 'cus_1',
      frozenAt: null,
      welcomeCreditsSkippedAt: new Date(),
      ...over,
    });

  it('starts with the claim', async () => {
    const b = build();
    at(T0.getTime() + 5 * MINUTE);
    claimed(b);
    expect((await b.plus.earlyBirdWindow('org-1'))?.startedAt).toEqual(
      new Date(T0.getTime() + 5 * MINUTE)
    );
  });

  it('starts with a skip too, without a claim', async () => {
    const b = build();
    skipped(b);
    at(T0.getTime() + 59 * MINUTE);
    expect(await b.plus.earlyBird('org-1')).toMatchObject({
      percent: 10,
      expiresAt: new Date(T0.getTime() + 60 * MINUTE),
      extended: false,
    });
    at(T0.getTime() + 60 * MINUTE + 24 * HOUR);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
  });

  it('starts at whichever came first of the claim and the skip, once', async () => {
    const b = build();
    claimed(b);
    // A later skip does not restart it.
    at(T0.getTime() + 2 * HOUR);
    b.setWallet({
      stripeCustomerId: 'cus_1',
      frozenAt: null,
      welcomeCreditsSkippedAt: new Date(),
    });
    expect((await b.plus.earlyBirdWindow('org-1'))?.startedAt).toEqual(T0);
    // Defensive: a claim is refused after a skip, but were both there, the
    // earlier skip would still win.
    at(T0);
    const c = build();
    skipped(c);
    at(T0.getTime() + 3 * HOUR);
    c.add({ type: 'GRANT', amount: 10000, idempotencyKey: 'welcome:org-1' });
    expect((await c.plus.earlyBirdWindow('org-1'))?.startedAt).toEqual(T0);
  });

  it('is never offered after a skip once the workspace had Plus', async () => {
    const b = build();
    skipped(b, plusWallet({ plusStatus: 'canceled', plusPeriodEnd: T0 }));
    at(T0.getTime() + 10 * MINUTE);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
  });

  it('is never offered again once the workspace had Plus (first payment only)', async () => {
    const b = build();
    claimed(b);
    b.setWallet(plusWallet({ plusStatus: 'canceled', plusPeriodEnd: T0 }));
    at(T0.getTime() + 10 * MINUTE);
    expect(await b.plus.earlyBird('org-1')).toBeNull();
  });
});

describe('Early-bird email', () => {
  const ready = (settings = SETTINGS) => {
    const b = build(settings);
    b.add({ type: 'GRANT', amount: 10000, idempotencyKey: 'welcome:org-1' });
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    return b;
  };

  it('waits for the first window, then sends once while not subscribed', async () => {
    const b = ready();
    expect(await b.plus.earlyBirdEmailDelay('org-1')).toBe(60 * MINUTE);
    at(T0.getTime() + 61 * MINUTE);
    expect(await b.plus.sendEarlyBirdEmail('org-1')).toBe(true);
    expect(b.notifications.sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, html] = (b.notifications.sendEmail as jest.Mock).mock
      .calls[0];
    expect(to).toBe('admin@example.com');
    expect(subject).toBe('Your 10% Plus code is extended for 24 hours');
    // The code, what it gives and until when, in plain words.
    expect(html).toContain(b.row().plusEarlyBirdCode);
    expect(html).toContain('10% off your first payment');
    expect(html).toContain('Expires Monday 2 November, 01:00 UTC, in 24 hours.');
    // What Plus includes and costs, from the settings.
    expect(html).toContain('400 credits every 30 days');
    expect(html).toContain('Posting to X and research data');
    expect(html).toContain('9% cheaper than top-ups');
    expect(html).toContain('$21.05');
    expect(html).toContain('$19.00 a month');
    expect(html).toContain('href="https://studio.test/plus"');
    expect(html).toContain("won't come back");
    // A retry sends nothing more.
    expect(await b.plus.sendEarlyBirdEmail('org-1')).toBe(false);
    expect(b.notifications.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('schedules its workflow when the early bird starts with a skip, never without one', async () => {
    const none = build();
    none.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    await none.plus.startEarlyBird('org-1');
    expect(none.workflowStart).not.toHaveBeenCalled();

    const b = build();
    b.setWallet({
      stripeCustomerId: 'cus_1',
      frozenAt: null,
      welcomeCreditsSkippedAt: new Date(),
    });
    await b.plus.startEarlyBird('org-1');
    expect(b.workflowStart).toHaveBeenCalledWith(
      'plusEarlyBirdEmailWorkflow',
      expect.objectContaining({
        workflowId: 'plus_early_bird_org-1',
        args: [{ organizationId: 'org-1' }],
      })
    );
    expect(await b.plus.earlyBirdEmailDelay('org-1')).toBe(60 * MINUTE);
  });

  it('sends nothing when subscribed, too early, switched off or without an extension', async () => {
    const subscribed = ready();
    subscribed.setWallet(plusWallet({ plusPeriodStart: T0 }));
    at(T0.getTime() + 61 * MINUTE);
    expect(await subscribed.plus.sendEarlyBirdEmail('org-1')).toBe(false);

    at(T0);
    const early = ready();
    at(T0.getTime() + 10 * MINUTE);
    expect(await early.plus.sendEarlyBirdEmail('org-1')).toBe(false);

    at(T0);
    const off = ready({ ...SETTINGS, [PLUS.earlyBirdEmail]: 'off' });
    at(T0.getTime() + 61 * MINUTE);
    expect(await off.plus.sendEarlyBirdEmail('org-1')).toBe(false);

    at(T0);
    const noExtension = ready({ ...SETTINGS, [PLUS.earlyBirdExtensionHours]: '0' });
    expect(await noExtension.plus.earlyBirdEmailDelay('org-1')).toBeNull();

    for (const b of [subscribed, early, off]) {
      expect(b.notifications.sendEmail).not.toHaveBeenCalled();
    }
  });
});

describe('Early-bird email preview', () => {
  it('renders the real email for a live early bird, without marking it sent', async () => {
    const b = build();
    b.add({ type: 'GRANT', amount: 10000, idempotencyKey: 'welcome:org-1' });
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    at(T0.getTime() + 61 * MINUTE);
    expect(await b.plus.sendEarlyBirdEmailPreview('org-1')).toEqual({
      sentTo: ['admin@example.com'],
      sample: false,
    });
    const [, subject, html] = (b.notifications.sendEmail as jest.Mock).mock
      .calls[0];
    expect(subject).toBe('[Preview] Your 10% Plus code is extended for 24 hours');
    expect(html).toContain(b.row().plusEarlyBirdCode);
    expect(b.row().plusEarlyBirdEmailAt).toBeUndefined();
    expect(html).toContain('in 24 hours');
    // The real one still goes out.
    expect(await b.plus.sendEarlyBirdEmail('org-1')).toBe(true);
    expect((b.notifications.sendEmail as jest.Mock).mock.calls[1][2]).toBe(html);
  });

  it('shows the end of the extension even before it starts', async () => {
    const b = build();
    b.add({ type: 'GRANT', amount: 10000, idempotencyKey: 'welcome:org-1' });
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    at(T0.getTime() + 10 * MINUTE);
    await b.plus.sendEarlyBirdEmailPreview('org-1');
    const [, , html] = (b.notifications.sendEmail as jest.Mock).mock.calls[0];
    expect(html).toContain('Expires Monday 2 November, 01:00 UTC, in 25 hours.');
  });

  it('shows a sample code when there is no early bird, making nothing at Stripe', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    expect(await b.plus.sendEarlyBirdEmailPreview('org-1')).toMatchObject({
      sample: true,
    });
    const [, , html] = (b.notifications.sendEmail as jest.Mock).mock.calls[0];
    expect(html).toMatch(/PREV-[A-Z2-9]{5}/);
    expect(html).toContain('in 24 hours');
    expect(b.stripe.promotionCodes.create).not.toHaveBeenCalled();
  });

  it('refuses without the settings', async () => {
    const settings = { ...SETTINGS };
    delete settings[PLUS.earlyBirdPercent];
    const b = build(settings);
    await expect(b.plus.sendEarlyBirdEmailPreview('org-1')).rejects.toThrow(
      PlusUnavailableError
    );
  });
});

describe('Plus refunds and disputes', () => {
  const refund = {
    id: 'evt_refund',
    type: 'charge.refunded',
    data: {
      object: {
        payment_intent: 'pi_plus',
        amount: 1900,
        amount_refunded: 1900,
        currency: 'usd',
        metadata: {},
      },
    },
  } as any;
  const dispute = {
    id: 'evt_dispute',
    type: 'charge.dispute.created',
    data: {
      object: { id: 'dp_1', payment_intent: 'pi_plus', reason: 'fraudulent' },
    },
  } as any;

  // A workspace on Plus that spent 100 of its 400 plan credits, whose
  // invoice was paid by pi_plus.
  const onPlus = async () => {
    const b = build();
    b.setWallet(plusWallet());
    await b.wallet.syncPlan('org-1');
    at(T0.getTime() + DAY);
    b.add({ type: 'SPEND', amount: -10000 });
    at(T0.getTime() + 2 * DAY);
    (b.stripe.invoicePayments.list as jest.Mock).mockResolvedValue({
      data: [
        {
          invoice: {
            id: 'in_1',
            customer: 'cus_1',
            parent: {
              subscription_details: {
                subscription: 'sub_1',
                metadata: { service: 'wallet', kind: 'plus', organizationId: 'org-1' },
              },
            },
          },
        },
      ],
    });
    (b.stripe.subscriptions.cancel as jest.Mock).mockImplementation(async () => {
      b.setSubscription(subscription({ status: 'canceled' }));
      return {};
    });
    (walletAlert as jest.Mock).mockClear();
    return b;
  };
  const balance = (b: ReturnType<typeof build>) =>
    b.entries.reduce((sum, e) => sum + e.amount, 0);
  const takenBack = (b: ReturnType<typeof build>) =>
    b.entries.filter((e) => e.type === 'PLAN_EXPIRE');

  for (const [name, event] of [
    ['refund', refund],
    ['dispute', dispute],
  ] as const) {
    it(`a ${name} cancels Plus at once, takes back the plan credits left and freezes the wallet`, async () => {
      const b = await onPlus();
      expect(await b.billing.handleEvent(event)).toEqual({ ok: true });
      expect(b.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
      expect(b.stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(takenBack(b)).toHaveLength(1);
      expect(takenBack(b)[0].amount).toBe(-30000);
      expect(balance(b)).toBe(0);
      expect(b.row().frozenAt).toBeInstanceOf(Date);
      expect(b.row().autoTopUp).toBe(false);
      expect(plusIsActive(b.row())).toBe(false);
      expect(walletAlert).toHaveBeenCalledWith(
        expect.stringContaining('cancelled subscription sub_1')
      );
    });
  }

  it('the same event twice, or a refund then a dispute, has one effect', async () => {
    const b = await onPlus();
    await b.billing.handleEvent(refund);
    await b.billing.handleEvent(refund);
    await b.billing.handleEvent(dispute);
    expect(b.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
    expect(takenBack(b)).toHaveLength(1);
    expect(balance(b)).toBe(0);
    expect(b.notifications.inAppNotification).toHaveBeenCalledTimes(1);
    // The period's own expiry later takes nothing more.
    at(T0.getTime() + 31 * DAY);
    await b.wallet.syncPlan('org-1');
    expect(takenBack(b)).toHaveLength(1);
    expect(balance(b)).toBe(0);
  });

  it('a failing Stripe cancel never throws: it alerts, and the credits and the freeze still happen', async () => {
    const b = await onPlus();
    (b.stripe.subscriptions.cancel as jest.Mock).mockRejectedValue(
      new Error('stripe down')
    );
    await expect(b.billing.handleEvent(refund)).resolves.toEqual({ ok: true });
    expect(walletAlert).toHaveBeenCalledWith(
      expect.stringContaining('could not be cancelled')
    );
    expect(takenBack(b)).toHaveLength(1);
    expect(balance(b)).toBe(0);
    expect(b.row().frozenAt).toBeInstanceOf(Date);
  });

  it('Stripe ending the subscription afterwards changes nothing more', async () => {
    const b = await onPlus();
    await b.billing.handleEvent(refund);
    await b.plus.handleEvent({
      id: 'evt_deleted',
      type: 'customer.subscription.deleted',
      data: { object: subscription({ status: 'canceled', ended_at: Math.floor(Date.now() / 1000) }) },
    } as any);
    expect(takenBack(b)).toHaveLength(1);
    expect(b.entries.filter((e) => e.type === 'PLAN_GRANT')).toHaveLength(1);
    expect(balance(b)).toBe(0);
  });

  it('a period that ended unsynced expires at its own end first', async () => {
    const b = await onPlus();
    at(T0.getTime() + 30 * DAY + 12 * HOUR);
    b.add({ type: 'TOPUP', amount: 19000, idempotencyKey: 'topup:pi_later' });
    b.add({ type: 'SPEND', amount: -5000 });
    await b.billing.handleEvent(refund);
    expect(takenBack(b)).toHaveLength(1);
    expect(takenBack(b)[0].amount).toBe(-30000);
    expect(balance(b)).toBe(14000);
  });

  it('a payment of an earlier subscription leaves the current one alone', async () => {
    const b = await onPlus();
    b.setWallet(plusWallet({ plusSubscriptionId: 'sub_2' }));
    await b.billing.handleEvent(dispute);
    expect(walletAlert).toHaveBeenCalledWith(
      expect.stringContaining('not org org-1\'s current sub_2')
    );
    expect(b.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(takenBack(b)).toHaveLength(0);
    expect(b.row().frozenAt).toBeNull();
  });

  it('a wallet that cannot be read never throws, and is alerted', async () => {
    const b = await onPlus();
    (b.repo.getWallet as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(b.billing.handleEvent(refund)).resolves.toEqual({ ok: true });
    expect(walletAlert).toHaveBeenCalledWith(
      expect.stringContaining('could not be read')
    );
    expect(b.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('a failing take-back never throws: the freeze and the cancel still happen', async () => {
    const b = await onPlus();
    (b.repo.planGrants as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(b.billing.handleEvent(refund)).resolves.toEqual({ ok: true });
    expect(walletAlert).toHaveBeenCalledWith(
      expect.stringContaining('could not be taken back')
    );
    expect(b.row().frozenAt).toBeInstanceOf(Date);
    expect(b.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
  });

  it('a failing invoice lookup never throws and changes nothing', async () => {
    const b = await onPlus();
    (b.stripe.invoicePayments.list as jest.Mock).mockRejectedValue(
      new Error('stripe down')
    );
    await expect(b.billing.handleEvent(dispute)).resolves.toEqual({ ok: true });
    expect(walletAlert).toHaveBeenCalledWith(
      expect.stringContaining('could not tell whether it paid for Plus')
    );
    expect(takenBack(b)).toHaveLength(0);
    expect(b.row().frozenAt).toBeNull();
  });

  it('an invoice of another Stripe customer changes nothing', async () => {
    const b = await onPlus();
    b.setWallet(plusWallet({ stripeCustomerId: 'cus_other' }));
    await b.billing.handleEvent(refund);
    expect(b.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(takenBack(b)).toHaveLength(0);
    expect(b.row().frozenAt).toBeNull();
  });

  it('a top-up refund is handled as before, without touching Plus', async () => {
    const b = await onPlus();
    b.add({
      type: 'TOPUP',
      amount: 19000,
      idempotencyKey: 'topup:pi_topup',
    });
    await b.billing.handleEvent({
      ...refund,
      data: {
        object: { ...refund.data.object, payment_intent: 'pi_topup', metadata: { service: 'wallet' } },
      },
    });
    expect(b.stripe.invoicePayments.list).not.toHaveBeenCalled();
    expect(b.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(takenBack(b)).toHaveLength(0);
    const clawBack = b.entries.filter((e) => e.type === 'ADJUST');
    expect(clawBack).toHaveLength(1);
    expect(clawBack[0].amount).toBe(-19000);
    expect(b.row().frozenAt).toBeInstanceOf(Date);
  });

  it('a refund of a payment that is neither changes nothing', async () => {
    const b = build();
    b.setWallet(plusWallet());
    await b.billing.handleEvent(refund);
    expect(b.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(b.row().frozenAt).toBeNull();
  });
});

describe('Plus webhooks', () => {
  const event = (type: string, object: any) =>
    ({ id: `evt_${type}`, type, data: { object } } as any);

  it('records the subscription and grants once, however often an event comes', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    const paid = event('invoice.paid', {
      parent: {
        subscription_details: {
          subscription: 'sub_1',
          metadata: { service: 'wallet', kind: 'plus' },
        },
      },
    });
    expect(await b.plus.handleEvent(paid)).toEqual({ ok: true });
    expect(await b.plus.handleEvent(paid)).toEqual({ ok: true });
    expect(
      await b.plus.handleEvent(
        event('checkout.session.completed', {
          mode: 'subscription',
          subscription: 'sub_1',
          metadata: { service: 'wallet', kind: 'plus' },
        })
      )
    ).toEqual({ ok: true });
    expect(b.row()).toMatchObject({
      plusSubscriptionId: 'sub_1',
      plusStatus: 'active',
      plusInterval: 'month',
      plusCredits: 40000,
      plusPeriodDays: 30,
    });
    const grants = b.entries.filter((e) => e.type === 'PLAN_GRANT');
    expect(grants).toHaveLength(1);
    expect(grants[0].amount).toBe(40000);
    expect(await b.wallet.balance('org-1')).toBe(40000);
    expect(b.notifications.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('leaves other events to the top-up handler', async () => {
    const { plus } = build();
    expect(
      await plus.handleEvent(
        event('checkout.session.completed', {
          mode: 'payment',
          metadata: { service: 'wallet', kind: 'topup' },
        })
      )
    ).toBeUndefined();
    expect(
      await plus.handleEvent(event('payment_intent.succeeded', {}))
    ).toBeUndefined();
  });

  it('never throws when Stripe or the database fails', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1' });
    (b.stripe.subscriptions.retrieve as jest.Mock).mockRejectedValueOnce(
      new Error('stripe down')
    );
    const updated = event('customer.subscription.updated', {
      id: 'sub_1',
      metadata: { service: 'wallet', kind: 'plus' },
    });
    await expect(b.plus.handleEvent(updated)).resolves.toEqual({ ok: true });
    b.repo.updateWallet.mockRejectedValueOnce(new Error('db down'));
    await expect(b.plus.handleEvent(updated)).resolves.toEqual({ ok: true });
    expect(walletAlert).toHaveBeenCalledTimes(2);
  });

  it('records nothing for a subscription on another customer', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_other' });
    await b.plus.handleEvent(
      event('customer.subscription.created', {
        id: 'sub_1',
        metadata: { service: 'wallet', kind: 'plus' },
      })
    );
    expect(b.row().plusSubscriptionId).toBeUndefined();
    expect(walletAlert).toHaveBeenCalled();
  });

  it('keeps access until the end of the paid span after a cancel', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1' });
    b.setSubscription(subscription({ cancel_at_period_end: true }));
    await b.plus.syncSubscription('sub_1');
    expect(b.row().plusCancelAt).toEqual(new Date(T0.getTime() + 30 * DAY));
    at(T0.getTime() + 29 * DAY);
    expect(await b.wallet.hasPlus('org-1')).toBe(true);
    at(T0.getTime() + 30 * DAY);
    expect(await b.wallet.hasPlus('org-1')).toBe(false);
  });

  it('stops access for a renewal that was not paid', async () => {
    expect(plusIsActive(plusWallet({ plusStatus: 'past_due' }) as any, T0)).toBe(
      false
    );
    expect(plusIsActive(plusWallet() as any, T0)).toBe(true);
    expect(
      plusIsActive(plusWallet({ frozenAt: T0 }) as any, T0)
    ).toBe(false);
  });
});

describe('Hourly plan sync', () => {
  it('reads a subscription again from Stripe when its renewal was missed', async () => {
    const b = build();
    b.setWallet(plusWallet());
    const housekeeping = new WalletHousekeepingService(
      { storageOfWalletOrganizations: jest.fn(async () => []) } as any,
      b.wallet,
      b.billing,
      b.plus
    );
    // Renewed in Stripe, but no event reached us.
    b.setSubscription(
      subscription({
        items: {
          data: [
            {
              current_period_start: Math.floor((T0.getTime() + 30 * DAY) / 1000),
              current_period_end: Math.floor((T0.getTime() + 60 * DAY) / 1000),
              price: { recurring: { interval: 'month' } },
            },
          ],
        },
      })
    );
    at(T0.getTime() + 30 * DAY + HOUR);
    await housekeeping.run();
    expect(b.row().plusPeriodEnd).toEqual(new Date(T0.getTime() + 60 * DAY));
    expect(b.entries.filter((e) => e.type === 'PLAN_GRANT')).toHaveLength(1);
    expect(await b.wallet.hasPlus('org-1')).toBe(true);
  });
});

describe('Plan credits', () => {
  it('splits a year into twelve periods and a month into one', () => {
    const year = planPeriods(T0, new Date(T0.getTime() + 365 * DAY), 30);
    expect(year).toHaveLength(12);
    expect(year[11].end).toEqual(new Date(T0.getTime() + 365 * DAY));
    expect(planPeriods(T0, new Date(T0.getTime() + 28 * DAY), 30)).toHaveLength(1);
    expect(planPeriods(T0, new Date(T0.getTime() + 31 * DAY), 30)).toHaveLength(1);
  });

  it('grants a month once and expires what is left at its end', async () => {
    const b = build();
    b.setWallet(plusWallet());
    await b.wallet.syncPlan('org-1');
    await b.wallet.syncPlan('org-1');
    expect(b.entries.filter((e) => e.type === 'PLAN_GRANT')).toHaveLength(1);
    at(T0.getTime() + 10 * DAY);
    await b.wallet.charge({
      organizationId: 'org-1',
      actionKey: 'ai.image',
      chargeKey: 'usage:1',
      unitPrice: 10000,
    });
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      balance: 30000,
      plan: 30000,
      topUp: 0,
      planResetsAt: new Date(T0.getTime() + 30 * DAY),
    });
    // The month is over and not renewed: the 300 credits left are gone.
    at(T0.getTime() + 30 * DAY + 1);
    await b.wallet.syncPlan('org-1');
    const expired = b.entries.filter((e) => e.type === 'PLAN_EXPIRE');
    expect(expired).toHaveLength(1);
    expect(expired[0].amount).toBe(-30000);
    expect(await b.wallet.balance('org-1')).toBe(0);
    // And never twice.
    await b.wallet.syncPlan('org-1');
    expect(b.entries.filter((e) => e.type === 'PLAN_EXPIRE')).toHaveLength(1);
  });

  it('spends plan credits before top-up credits', async () => {
    const b = build();
    b.setWallet(plusWallet());
    b.add({ type: 'TOPUP', amount: 10000, idempotencyKey: 'topup:pi_1' });
    await b.wallet.syncPlan('org-1');
    at(T0.getTime() + DAY);
    await b.wallet.charge({
      organizationId: 'org-1',
      actionKey: 'ai.image',
      chargeKey: 'usage:1',
      unitPrice: 5000,
    });
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      balance: 45000,
      plan: 35000,
      topUp: 10000,
    });
    // Spending past the plan credits takes the top-up credits.
    await b.wallet.charge({
      organizationId: 'org-1',
      actionKey: 'ai.image',
      chargeKey: 'usage:2',
      unitPrice: 38000,
    });
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      balance: 7000,
      plan: 0,
      topUp: 7000,
    });
    // At the end of the period, the top-up credits stay.
    at(T0.getTime() + 31 * DAY);
    await b.wallet.syncPlan('org-1');
    expect(await b.wallet.balance('org-1')).toBe(7000);
  });

  it('releases an annual plan every period, twelve times, without rollover', async () => {
    const b = build();
    b.setWallet(plusWallet({}, T0, 365));
    for (let day = 0; day < 365; day += 5) {
      at(T0.getTime() + day * DAY + HOUR);
      await b.wallet.syncPlan('org-1');
      // Never more than one period's credits at a time.
      expect(await b.wallet.balance('org-1')).toBeLessThanOrEqual(40000);
    }
    expect(b.entries.filter((e) => e.type === 'PLAN_GRANT')).toHaveLength(12);
    at(T0.getTime() + 365 * DAY + 1);
    await b.wallet.syncPlan('org-1');
    expect(b.entries.filter((e) => e.type === 'PLAN_EXPIRE')).toHaveLength(12);
    expect(await b.wallet.balance('org-1')).toBe(0);
  });

  it('grants nothing without Plus, and stops when the span is cut short', async () => {
    const b = build();
    b.setWallet(plusWallet({ plusStatus: 'past_due' }));
    await b.wallet.syncPlan('org-1');
    expect(b.entries).toHaveLength(0);

    const cut = build();
    cut.setWallet(plusWallet());
    await cut.wallet.syncPlan('org-1');
    at(T0.getTime() + 5 * DAY);
    cut.setWallet(
      plusWallet({ plusStatus: 'canceled', plusPeriodEnd: new Date(T0.getTime() + 5 * DAY) })
    );
    await cut.wallet.syncPlan('org-1');
    expect(await cut.wallet.balance('org-1')).toBe(0);
  });
});

describe('Access', () => {
  it('opens the paid rows for Plus, locks them for the free plan', async () => {
    const free = build();
    free.setWallet({ frozenAt: null, firstTopUpAt: null });
    const plusWorkspace = build();
    plusWorkspace.setWallet(plusWallet());
    for (const key of ['x.post', 'data.run']) {
      const action = (await free.wallet.price(key))!.action;
      expect(await free.wallet.usageLocked('org-1', action)).toBe(true);
      expect(await plusWorkspace.wallet.usageLocked('org-1', action)).toBe(false);
    }
    // A row that needs no Plus stays open to the free credits.
    const image = (await free.wallet.price('ai.image'))!.action;
    expect(await free.wallet.usageLocked('org-1', image)).toBe(false);
    expect(await free.wallet.unlocksProvider('org-1', 'x')).toBe(false);
    expect(await plusWorkspace.wallet.unlocksProvider('org-1', 'x')).toBe(true);
  });

  // Plus launched a day before T0: a first top-up at T0 came after it.
  const LAUNCHED = { ...SETTINGS, [PLUS.launchAt]: new Date(T0.getTime() - DAY).toISOString() };
  const BEFORE_LAUNCH = new Date(T0.getTime() - 10 * DAY);

  it('keeps a top-up from after the launch open until its balance runs out', async () => {
    const b = build(LAUNCHED);
    b.setWallet({ frozenAt: null, firstTopUpAt: T0 });
    b.add({ type: 'TOPUP', amount: 500, idempotencyKey: 'topup:pi_old' });
    expect(await b.wallet.access('org-1')).toMatchObject({
      plus: false,
      legacy: false,
      grandfathered: true,
      open: true,
      topUpAllowed: false,
    });
    b.add({ type: 'SPEND', amount: -500 });
    expect(await b.wallet.access('org-1')).toMatchObject({
      grandfathered: false,
      open: false,
    });
    expect(await b.wallet.isPayAsYouGo('org-1')).toBe(false);
  });

  it('refuses top-ups and auto top-up without Plus after the launch', async () => {
    const b = build(LAUNCHED);
    b.setWallet({
      frozenAt: null,
      firstTopUpAt: T0,
      stripeCustomerId: 'cus_1',
      autoTopUp: true,
      paymentMethodId: 'pm_1',
      autoTopUpAmount: 1000,
    });
    await expect(
      b.billing.createCheckout({
        organizationId: 'org-1',
        amount: 1000,
        saveCard: false,
        returnUrl: 'x',
      })
    ).rejects.toThrow(PlusRequiredError);
    await expect(
      b.billing.createCardSetup({ organizationId: 'org-1', returnUrl: 'x' })
    ).rejects.toThrow(PlusRequiredError);
    expect(await b.billing.autoTopUp('org-1', 100)).toBe(false);
    expect(await b.wallet.autoTopUpHeadroom('org-1')).toBe(0);
  });

  describe('pay-as-you-go from before Plus', () => {
    const legacyWallet = (over: Record<string, any> = {}) => ({
      frozenAt: null,
      firstTopUpAt: BEFORE_LAUNCH,
      stripeCustomerId: 'cus_1',
      autoTopUp: true,
      paymentMethodId: 'pm_1',
      autoTopUpAmount: 1000,
      autoTopUpMonthlyCap: 5000,
      autoTopUpThreshold: 10000,
      ...over,
    });
    const charges = (b: ReturnType<typeof build>) => {
      const create = jest.fn(async (params: any) => ({
        id: `pi_${create.mock.calls.length}`,
        status: 'succeeded',
        amount: params.amount,
        amount_received: params.amount,
        currency: params.currency,
        metadata: params.metadata,
      }));
      (b.stripe.paymentIntents as any).create = create;
      return create;
    };

    it('keeps X and research open at a zero balance; the charge still needs credits', async () => {
      const b = build(LAUNCHED);
      b.setWallet(legacyWallet({ autoTopUp: false }));
      expect(await b.wallet.balance('org-1')).toBe(0);
      expect(await b.wallet.access('org-1')).toMatchObject({
        plus: false,
        legacy: true,
        grandfathered: false,
        open: true,
        topUpAllowed: true,
      });
      for (const key of ['x.post', 'data.run']) {
        const action = (await b.wallet.price(key))!.action;
        expect(await b.wallet.usageLocked('org-1', action)).toBe(false);
      }
      expect(await b.wallet.unlocksProvider('org-1', 'x')).toBe(true);
      // No Plus gate: the quote is open, only short of credits.
      expect(await b.wallet.quoteUsage('org-1', 'data.run', 1)).toMatchObject({
        locked: false,
        short: true,
      });
      await expect(
        b.wallet.charge({
          organizationId: 'org-1',
          actionKey: 'x.post',
          chargeKey: 'post:legacy',
        })
      ).rejects.toThrow();
    });

    it('can buy top-ups and save a card', async () => {
      const b = build(LAUNCHED);
      b.setWallet(legacyWallet());
      await expect(
        b.billing.createCheckout({
          organizationId: 'org-1',
          amount: 1000,
          saveCard: true,
          returnUrl: 'x',
        })
      ).resolves.toMatchObject({ url: expect.any(String) });
      await expect(
        b.billing.createCardSetup({ organizationId: 'org-1', returnUrl: 'x' })
      ).resolves.toMatchObject({ url: expect.any(String) });
    });

    it('tops up automatically with its card', async () => {
      const b = build(LAUNCHED);
      b.setWallet(legacyWallet());
      const create = charges(b);
      expect(await b.wallet.autoTopUpHeadroom('org-1')).toBeGreaterThan(0);
      expect(await b.billing.autoTopUp('org-1')).toBe(true);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1000, payment_method: 'pm_1' }),
        expect.anything()
      );
    });

    it('is not open while the wallet is on hold', async () => {
      const b = build(LAUNCHED);
      b.setWallet(legacyWallet({ frozenAt: T0 }));
      expect(await b.wallet.access('org-1')).toMatchObject({
        legacy: true,
        open: false,
        topUpAllowed: false,
      });
      expect(await b.billing.autoTopUp('org-1')).toBe(false);
    });

    it('is Plus while subscribed, and pay-as-you-go again once Plus ends', async () => {
      const b = build(LAUNCHED);
      b.setWallet(plusWallet(legacyWallet()));
      expect(await b.wallet.access('org-1')).toMatchObject({
        plus: true,
        legacy: false,
        topUpAllowed: true,
      });
      b.setSubscription(
        subscription({
          status: 'canceled',
          ended_at: Math.floor((T0.getTime() + 30 * DAY) / 1000),
        })
      );
      await b.plus.handleEvent({
        id: 'evt_deleted',
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_1', metadata: { service: 'wallet', kind: 'plus' } },
        },
      } as any);
      at(T0.getTime() + 31 * DAY);
      expect(await b.wallet.access('org-1')).toMatchObject({
        plus: false,
        legacy: true,
        open: true,
        topUpAllowed: true,
      });
      // Auto top-up stays on: it is still allowed.
      expect(b.row()).toMatchObject({ autoTopUp: true });
      expect(b.row().autoTopUpOffReason).toBeFalsy();
    });

    it('never charges the card while a Plus payment is failing', async () => {
      const b = build(LAUNCHED);
      b.setWallet(plusWallet(legacyWallet({ plusStatus: 'past_due' })));
      const create = charges(b);
      expect(await b.wallet.access('org-1')).toMatchObject({ legacy: true, open: true });
      expect(await b.billing.autoTopUp('org-1', 5000)).toBe(false);
      expect(await b.wallet.autoTopUpHeadroom('org-1')).toBe(0);
      expect(create).not.toHaveBeenCalled();
    });

    it('a first top-up at the launch moment or later is not from before Plus', async () => {
      const b = build(LAUNCHED);
      b.setWallet(legacyWallet({ firstTopUpAt: new Date(LAUNCHED[PLUS.launchAt]) }));
      expect(await b.wallet.access('org-1')).toMatchObject({ legacy: false, topUpAllowed: false });
    });

    it('a workspace that topped up on Plus after the launch loses auto top-up when Plus ends', async () => {
      const b = build(LAUNCHED);
      b.setWallet(plusWallet(legacyWallet({ firstTopUpAt: T0 })));
      b.setSubscription(
        subscription({
          status: 'canceled',
          ended_at: Math.floor((T0.getTime() + 30 * DAY) / 1000),
        })
      );
      await b.plus.handleEvent({
        id: 'evt_deleted',
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_1', metadata: { service: 'wallet', kind: 'plus' } },
        },
      } as any);
      expect(b.row()).toMatchObject({ autoTopUp: false, autoTopUpOffReason: 'plus_ended' });
      at(T0.getTime() + 31 * DAY);
      expect(await b.wallet.access('org-1')).toMatchObject({ legacy: false, topUpAllowed: false });
    });

    it('counts every wallet that topped up as from before Plus without the launch setting', async () => {
      for (const settings of [SETTINGS, { ...SETTINGS, [PLUS.launchAt]: 'not a date' }]) {
        const b = build(settings);
        b.setWallet(legacyWallet({ firstTopUpAt: T0, autoTopUp: false }));
        expect(await b.wallet.access('org-1')).toMatchObject({
          legacy: true,
          open: true,
          topUpAllowed: true,
        });
        // Never topped up: still the free plan.
        b.setWallet({ frozenAt: null, firstTopUpAt: null });
        expect(await b.wallet.access('org-1')).toMatchObject({
          legacy: false,
          open: false,
          topUpAllowed: false,
        });
      }
    });
  });
});

describe('Rates', () => {
  it('reads the rates from the settings', async () => {
    expect(await build().wallet.rates()).toEqual({
      currency: 'USD',
      creditsPerUnit: 19,
      defaultMultiplierBp: 15789,
      defaultMultiplier: 1.5789,
    });
  });

  it('keeps every price the same at 19 credits a dollar and x1.5789', async () => {
    const old = build({
      ...SETTINGS,
      [BILLING.creditsPerUnit]: '20',
      [BILLING.defaultMultiplierBp]: '15000',
    });
    const now = build();
    const prices = async (b: ReturnType<typeof build>) =>
      (await b.wallet.priceList()).map((a) => [a.key, a.price]);
    expect(await prices(now)).toEqual(await prices(old));
    // A provider-reported cost is priced the same too.
    const image = (await now.wallet.price('ai.image'))!.action;
    for (const cost of [10_000, 40_000, 55_125, 1_000_000]) {
      expect(await now.wallet.usagePrice(image, 1, cost)).toBe(
        await old.wallet.usagePrice(image, 1, cost)
      );
    }
  });
});

// A span of a subscription as its first item reports it.
const span = (startMs: number, days = 30) => ({
  data: [
    {
      current_period_start: Math.floor(startMs / 1000),
      current_period_end: Math.floor((startMs + days * DAY) / 1000),
      price: { recurring: { interval: days > 31 ? 'year' : 'month' } },
    },
  ],
});
const sec = (ms: number) => Math.floor(ms / 1000);
const event = (type: string, object: any, id = `evt_${type}`) =>
  ({ id, type, data: { object } } as any);
const plusInvoiceEvent = (type: string, id?: string) =>
  event(
    type,
    {
      parent: {
        subscription_details: {
          subscription: 'sub_1',
          metadata: { service: 'wallet', kind: 'plus' },
        },
      },
    },
    id
  );
const grantsOf = (b: ReturnType<typeof build>) =>
  b.entries.filter((e) => e.type === 'PLAN_GRANT');
const housekeepingOf = (b: ReturnType<typeof build>) =>
  new WalletHousekeepingService(
    { storageOfWalletOrganizations: jest.fn(async () => []) } as any,
    b.wallet,
    b.billing,
    b.plus
  );

describe('Plan credits wait for the renewal to be paid', () => {
  const RENEWAL = T0.getTime() + 30 * DAY;

  // Plus bought at T0 (paid), with 100 of its 400 plan credits spent and
  // 100 top-up credits.
  const subscribed = async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    await b.plus.handleEvent(
      event('checkout.session.completed', {
        mode: 'subscription',
        subscription: 'sub_1',
        metadata: { service: 'wallet', kind: 'plus' },
      })
    );
    b.add({ type: 'TOPUP', amount: 10000, idempotencyKey: 'topup:pi_1' });
    at(T0.getTime() + 10 * DAY);
    await b.wallet.charge({
      organizationId: 'org-1',
      actionKey: 'ai.image',
      chargeKey: 'usage:before',
      unitPrice: 10000,
    });
    return b;
  };
  // Stripe renews: a new span, billed as a draft invoice first.
  const renew = (b: ReturnType<typeof build>, status: string, invoice: string) =>
    b.setSubscription(
      subscription({
        status,
        items: span(RENEWAL),
        latest_invoice: invoiceOf(sec(RENEWAL), invoice),
      })
    );

  it('renewal draft, then failed: no credits for the unpaid span, and nothing to spend from it', async () => {
    const b = await subscribed();
    expect(grantsOf(b)).toHaveLength(1);

    // The renewal's draft: Plus stays on, the new span has no credits yet.
    at(RENEWAL + MINUTE);
    renew(b, 'active', 'draft');
    await b.plus.handleEvent(
      event('customer.subscription.updated', {
        id: 'sub_1',
        metadata: { service: 'wallet', kind: 'plus' },
      })
    );
    expect(grantsOf(b)).toHaveLength(1);
    expect(await b.wallet.hasPlus('org-1')).toBe(true);
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 0,
      topUp: 10000,
      balance: 10000,
    });

    // Its payment fails: past due, Plus off, still no plan credits.
    at(RENEWAL + 2 * HOUR);
    renew(b, 'past_due', 'open');
    await b.plus.handleEvent(plusInvoiceEvent('invoice.payment_failed'));
    await housekeepingOf(b).run();
    expect(grantsOf(b)).toHaveLength(1);
    expect(await b.wallet.hasPlus('org-1')).toBe(false);
    expect(b.row().plusStatus).toBe('past_due');
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 0,
      topUp: 10000,
    });
    // An image is paid from the top-up credits only, and can't go past them.
    await b.wallet.charge({
      organizationId: 'org-1',
      actionKey: 'ai.image',
      chargeKey: 'usage:pastdue',
      unitPrice: 4000,
    });
    expect(await b.wallet.balance('org-1')).toBe(6000);
    await expect(
      b.wallet.charge({
        organizationId: 'org-1',
        actionKey: 'ai.image',
        chargeKey: 'usage:toomuch',
        unitPrice: 40000,
      })
    ).rejects.toThrow();
  });

  it('renewal draft, failed, then paid: the span is granted once, when paid', async () => {
    const b = await subscribed();
    at(RENEWAL + MINUTE);
    renew(b, 'active', 'draft');
    await b.plus.syncSubscription('sub_1');
    at(RENEWAL + 2 * HOUR);
    renew(b, 'past_due', 'open');
    await b.plus.handleEvent(plusInvoiceEvent('invoice.payment_failed'));
    expect(grantsOf(b)).toHaveLength(1);

    // The card is updated and Stripe collects it.
    at(RENEWAL + 3 * DAY);
    renew(b, 'active', 'paid');
    const paid = plusInvoiceEvent('invoice.paid');
    await b.plus.handleEvent(paid);
    await b.plus.handleEvent(paid);
    await b.plus.handleEvent(
      event('customer.subscription.updated', {
        id: 'sub_1',
        metadata: { service: 'wallet', kind: 'plus' },
      })
    );
    expect(grantsOf(b)).toHaveLength(2);
    expect(await b.wallet.hasPlus('org-1')).toBe(true);
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 40000,
      topUp: 10000,
    });
  });

  it('the hourly re-read grants a span whose payment event was missed', async () => {
    const b = await subscribed();
    at(RENEWAL + MINUTE);
    renew(b, 'active', 'draft');
    await b.plus.syncSubscription('sub_1');
    expect(grantsOf(b)).toHaveLength(1);
    // Paid in Stripe, but no event reached us.
    at(RENEWAL + 2 * HOUR);
    renew(b, 'active', 'paid');
    await housekeepingOf(b).run();
    expect(grantsOf(b)).toHaveLength(2);
    expect((await b.wallet.planCredits('org-1')).plan).toBe(40000);
  });

  it('a past-due span granted before this rule is taken back, not spendable', async () => {
    const b = build();
    b.setWallet(plusWallet());
    await b.wallet.syncPlan('org-1');
    expect(await b.wallet.balance('org-1')).toBe(40000);
    // Recorded past due, its span not paid (granted by an older release).
    at(T0.getTime() + HOUR);
    b.setWallet(plusWallet({ plusStatus: 'past_due', plusPaidPeriodStart: null }));
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 0,
      balance: 0,
    });
    await expect(
      b.wallet.charge({
        organizationId: 'org-1',
        actionKey: 'ai.image',
        chargeKey: 'usage:1',
        unitPrice: 5000,
      })
    ).rejects.toThrow();
  });

  it('a span taken back while past due is granted again once paid', async () => {
    const b = build();
    b.setWallet(plusWallet());
    await b.wallet.syncPlan('org-1');
    at(T0.getTime() + HOUR);
    b.setWallet(plusWallet({ plusStatus: 'past_due', plusPaidPeriodStart: null }));
    await b.wallet.syncPlan('org-1');
    expect(await b.wallet.balance('org-1')).toBe(0);
    // Paid two days later: the period's credits come back, once.
    at(T0.getTime() + 2 * DAY);
    b.setWallet(plusWallet());
    await b.wallet.syncPlan('org-1');
    await b.wallet.syncPlan('org-1');
    expect(grantsOf(b)).toHaveLength(2);
    expect(await b.wallet.balance('org-1')).toBe(40000);
    // And it ends with its period like any other.
    at(T0.getTime() + 30 * DAY + 1);
    await b.wallet.syncPlan('org-1');
    expect(await b.wallet.balance('org-1')).toBe(0);
  });

  it('stops re-reading a span Stripe gave up on, or one long past its start', async () => {
    const b = build();
    const housekeeping = housekeepingOf(b);
    for (const [status, ageDays] of [
      ['unpaid', 1],
      ['incomplete', 1],
      ['active', 5],
    ] as const) {
      b.setWallet(
        plusWallet({ plusStatus: status, plusPaidPeriodStart: null }, new Date(T0.getTime() - ageDays * DAY))
      );
      (b.stripe.subscriptions.retrieve as jest.Mock).mockClear();
      await housekeeping.run();
      expect(b.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    }
    b.setWallet(plusWallet({ plusStatus: 'past_due', plusPaidPeriodStart: null }));
    await housekeeping.run();
    expect(b.stripe.subscriptions.retrieve).toHaveBeenCalled();
  });

  it('a paid annual span keeps releasing every period', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    b.setSubscription(
      subscription({
        items: span(T0.getTime(), 365),
        metadata: { ...subscription().metadata, interval: 'year' },
      })
    );
    await b.plus.syncSubscription('sub_1');
    for (const day of [0, 31, 61, 91]) {
      at(T0.getTime() + day * DAY + HOUR);
      await b.wallet.syncPlan('org-1');
    }
    expect(grantsOf(b)).toHaveLength(4);
    expect(await b.wallet.balance('org-1')).toBe(40000);
  });
});

describe('Plan credits count only spends after their grant', () => {
  it('a late webhook: spends before the grant stay top-up spends', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    b.add({ type: 'TOPUP', amount: 10000, idempotencyKey: 'topup:pi_1' });
    // Paid at T0; the events arrive an hour later, after a spend.
    at(T0.getTime() + 30 * MINUTE);
    b.add({ type: 'SPEND', amount: -845 });
    at(T0.getTime() + HOUR);
    await b.plus.handleEvent(plusInvoiceEvent('invoice.paid'));
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 40000,
      topUp: 9155,
    });
    at(T0.getTime() + 2 * DAY);
    await b.wallet.charge({
      organizationId: 'org-1',
      actionKey: 'ai.image',
      chargeKey: 'usage:1',
      unitPrice: 5000,
    });
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 35000,
      topUp: 9155,
    });
    // At the period's end only the plan credits left go.
    at(T0.getTime() + 30 * DAY + 1);
    await b.wallet.syncPlan('org-1');
    const expired = b.entries.filter((e) => e.type === 'PLAN_EXPIRE');
    expect(expired).toHaveLength(1);
    expect(expired[0].amount).toBe(-35000);
    expect(await b.wallet.balance('org-1')).toBe(9155);
  });

  it('a backdated annual start: 400 plan and 100 top-up, then 500 after the next release', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    b.add({ type: 'TOPUP', amount: 10845, idempotencyKey: 'topup:pi_1' });
    // The span started five days ago; spends since then came from top-ups.
    at(T0.getTime() + 2 * DAY);
    b.add({ type: 'SPEND', amount: -845 });
    at(T0.getTime() + 5 * DAY);
    b.setSubscription(subscription({ items: span(T0.getTime(), 365) }));
    await b.plus.syncSubscription('sub_1');
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 40000,
      topUp: 10000,
    });
    at(T0.getTime() + 30 * DAY + HOUR);
    await b.wallet.syncPlan('org-1');
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      balance: 50000,
      plan: 40000,
      topUp: 10000,
    });
  });
});

describe('A plan expiry takes only what is left of its own grant', () => {
  const SECOND = 1000;
  const expired = (b: ReturnType<typeof build>) =>
    b.entries.filter((e) => e.type === 'PLAN_EXPIRE');
  const balance = (b: ReturnType<typeof build>) =>
    b.entries.reduce((sum, e) => sum + e.amount, 0);
  // A workspace with 17.30 top-up credits, granted its 400 Plus credits
  // seven seconds after its span started.
  const granted = async () => {
    const b = build();
    b.add({ type: 'TOPUP', amount: 1730, idempotencyKey: 'topup:pi_1' });
    b.setWallet(plusWallet());
    at(T0.getTime() + 7 * SECOND);
    await b.wallet.syncPlan('org-1');
    expect(b.entries.filter((e) => e.type === 'PLAN_GRANT')).toHaveLength(1);
    return b;
  };
  const spend = (b: ReturnType<typeof build>, key: string, amount: number) =>
    b.add({ type: 'SPEND', amount: -amount, idempotencyKey: key });
  // Stripe ends the subscription at once, its end dated `endedAt` (a test
  // clock can date it before the grant was written).
  const cancelAt = async (b: ReturnType<typeof build>, endedAt: number) => {
    const ended = subscription({ status: 'canceled', ended_at: sec(endedAt) });
    b.setSubscription(ended);
    await b.plus.handleEvent(event('customer.subscription.deleted', ended));
  };

  it('an immediate cancel after the grant expires the plan credits left, not the top-up', async () => {
    const b = await granted();
    at(T0.getTime() + HOUR);
    spend(b, 'post:1#1', 45);
    await cancelAt(b, Date.now());
    expect(expired(b)).toHaveLength(1);
    expect(expired(b)[0].amount).toBe(-39955);
    expect(balance(b)).toBe(1730);
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 0,
      topUp: 1730,
    });
  });

  it('a cancel dated before the grant was written still expires the whole grant left', async () => {
    const b = await granted();
    // A spend and its refund, then a cancel dated at the span's start.
    at(T0.getTime() + 5 * MINUTE);
    spend(b, 'post:1#1', 45);
    at(T0.getTime() + 6 * MINUTE);
    await b.wallet.refund('post:1#1');
    at(T0.getTime() + 7 * MINUTE);
    await cancelAt(b, T0.getTime());
    expect(b.row().plusPeriodEnd).toEqual(T0);
    expect(expired(b)).toHaveLength(1);
    expect(expired(b)[0].amount).toBe(-40000);
    expect(balance(b)).toBe(1730);
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      balance: 1730,
      plan: 0,
      topUp: 1730,
    });
  });

  it('a spend before the cut and after the grant counts, whenever the cut is dated', async () => {
    const b = await granted();
    at(T0.getTime() + HOUR);
    spend(b, 'usage:1#1', 10000);
    await cancelAt(b, T0.getTime());
    expect(expired(b)[0].amount).toBe(-30000);
    expect(balance(b)).toBe(1730);
  });

  it('a grant written after its period ended counts the spends since it was written', async () => {
    const b = build();
    b.add({ type: 'TOPUP', amount: 1730, idempotencyKey: 'topup:pi_1' });
    b.setWallet(plusWallet());
    // A period that ended at T0, granted an hour late.
    at(T0.getTime() + HOUR);
    b.add({
      type: 'PLAN_GRANT',
      amount: 40000,
      idempotencyKey: 'plus:late',
      meta: JSON.stringify({
        subscriptionId: 'sub_1',
        start: new Date(T0.getTime() - 30 * DAY).toISOString(),
        end: T0.toISOString(),
        index: 0,
      }),
    });
    at(T0.getTime() + 2 * HOUR);
    spend(b, 'usage:1#1', 5000);
    at(T0.getTime() + 3 * HOUR);
    b.setWallet(plusWallet({ plusStatus: 'canceled', plusPeriodEnd: T0 }));
    await b.wallet.syncPlan('org-1');
    expect(expired(b)).toHaveLength(1);
    expect(expired(b)[0].amount).toBe(-35000);
    expect(balance(b)).toBe(1730);
  });

  it('a refund of a spend made before the grant goes back to the top-up credits', async () => {
    const b = build();
    b.add({ type: 'TOPUP', amount: 10000, idempotencyKey: 'topup:pi_1' });
    spend(b, 'usage:0#1', 1000);
    b.setWallet(plusWallet());
    at(T0.getTime() + MINUTE);
    await b.wallet.syncPlan('org-1');
    at(T0.getTime() + DAY);
    spend(b, 'usage:1#1', 500);
    await b.wallet.refund('usage:0#1');
    expect(await b.wallet.planCredits('org-1')).toMatchObject({
      plan: 39500,
      topUp: 10000,
    });
    at(T0.getTime() + 30 * DAY + 1);
    await b.wallet.syncPlan('org-1');
    expect(expired(b)[0].amount).toBe(-39500);
    expect(balance(b)).toBe(10000);
  });

  it('a refund of a plan spend made after the period ended stays with the top-up credits', async () => {
    const b = await granted();
    at(T0.getTime() + DAY);
    spend(b, 'usage:1#1', 500);
    at(T0.getTime() + 30 * DAY + 1);
    await b.wallet.syncPlan('org-1');
    expect(expired(b)[0].amount).toBe(-39500);
    await b.wallet.refund('usage:1#1');
    expect(balance(b)).toBe(2230);
  });

  it('a payment taken back (refund or dispute) takes the plan credits left only', async () => {
    const b = await granted();
    at(T0.getTime() + DAY);
    spend(b, 'usage:1#1', 2500);
    expect(
      await b.wallet.takeBackPlanCredits('org-1', 'sub_1', 'Plus payment refunded')
    ).toBe(37500);
    expect(balance(b)).toBe(1730);
    // The take-back cancels Plus; nothing more goes later, at the period's
    // end or on a repeat.
    b.setWallet(plusWallet({ plusStatus: 'canceled', plusPeriodEnd: new Date() }));
    expect(
      await b.wallet.takeBackPlanCredits('org-1', 'sub_1', 'Plus payment refunded')
    ).toBe(0);
    at(T0.getTime() + 31 * DAY);
    await b.wallet.syncPlan('org-1');
    expect(expired(b)).toHaveLength(1);
    expect(balance(b)).toBe(1730);
  });

  it('a past-due span taken back leaves the top-up credits', async () => {
    const b = await granted();
    at(T0.getTime() + DAY);
    spend(b, 'usage:1#1', 2500);
    b.setWallet(plusWallet({ plusStatus: 'past_due', plusPaidPeriodStart: null }));
    await b.wallet.syncPlan('org-1');
    expect(expired(b)).toHaveLength(1);
    expect(expired(b)[0].amount).toBe(-37500);
    expect(balance(b)).toBe(1730);
  });

  it('never takes more than the balance, after a top-up was clawed back', async () => {
    const b = await granted();
    at(T0.getTime() + DAY);
    b.add({ type: 'ADJUST', amount: -5000, reference: 'pi_1' });
    await cancelAt(b, Date.now());
    expect(expired(b)[0].amount).toBe(-36730);
    expect(balance(b)).toBe(0);
  });
});

describe('One Plus subscription at a time', () => {
  const checkout = (b: ReturnType<typeof build>) =>
    b.plus.createCheckout({
      organizationId: 'org-1',
      interval: 'month',
      returnUrl: 'https://studio.test/plus',
    });

  for (const status of ['past_due', 'unpaid', 'incomplete', 'active', 'trialing']) {
    it(`refuses a second checkout while the one on record is ${status}`, async () => {
      const b = build();
      b.setWallet(plusWallet({ plusStatus: status }));
      b.setSubscription(subscription({ status }));
      const refused = checkout(b);
      await expect(refused).rejects.toThrow(PlusExistsError);
      await expect(checkout(b)).rejects.toThrow(
        ['active', 'trialing'].includes(status) ? 'already has Plus' : 'payment failed'
      );
      expect(b.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });
  }

  it('lets a new checkout through once Stripe says the old one ended', async () => {
    const b = build();
    b.setWallet(plusWallet({ plusStatus: 'past_due' }));
    b.setSubscription(
      subscription({ status: 'canceled', ended_at: sec(T0.getTime()) })
    );
    await expect(checkout(b)).resolves.toEqual({ url: 'https://stripe.test/cs_1' });
    expect(b.row().plusStatus).toBe('canceled');
  });

  it('tells the Plus page the payment failed, and opens the billing portal for the card', async () => {
    const b = build();
    b.setWallet(plusWallet({ plusStatus: 'past_due' }));
    const plan = await b.plus.plan('org-1');
    expect(plan.subscription).toMatchObject({
      active: false,
      paymentFailed: true,
      status: 'past_due',
    });
    expect(await b.plus.billingPortal('org-1')).toEqual({
      url: 'https://stripe.test/portal',
    });
    expect(b.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://studio.test/plus',
      flow_data: { type: 'payment_method_update' },
    });
    expect((await build().plus.plan('org-1')).subscription).toBeNull();
  });

  it('refuses the billing portal without a Plus subscription', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1' });
    await expect(b.plus.billingPortal('org-1')).rejects.toThrow(
      PlusUnavailableError
    );
  });

  it('tells the Plus page the wallet is on hold', async () => {
    const b = build();
    b.setWallet(plusWallet({ frozenAt: T0 }));
    expect((await b.plus.plan('org-1')).access).toMatchObject({
      frozen: true,
      plus: false,
    });
  });
});

describe('A dispute before Plus is recorded', () => {
  const dispute = event('charge.dispute.created', {
    id: 'dp_1',
    payment_intent: 'pi_plus',
    reason: 'fraudulent',
  }, 'evt_dispute');
  const completed = event('checkout.session.completed', {
    mode: 'subscription',
    subscription: 'sub_1',
    metadata: { service: 'wallet', kind: 'plus' },
  });

  // The checkout's payment is disputed before any Plus event was handled.
  const disputedFirst = (recorded: Record<string, any> = {}) => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null, ...recorded });
    (b.stripe.invoicePayments.list as jest.Mock).mockResolvedValue({
      data: [
        {
          invoice: {
            id: 'in_1',
            customer: 'cus_1',
            parent: {
              subscription_details: {
                subscription: 'sub_1',
                metadata: { service: 'wallet', kind: 'plus', organizationId: 'org-1' },
              },
            },
          },
        },
      ],
    });
    (b.stripe.subscriptions.cancel as jest.Mock).mockImplementation(async () => {
      b.setSubscription(
        subscription({ status: 'canceled', ended_at: sec(Date.now()) })
      );
      return {};
    });
    return b;
  };

  it('cancels the subscription and freezes the wallet; the later events never open Plus', async () => {
    const b = disputedFirst();
    await expect(b.billing.handleEvent(dispute)).resolves.toEqual({ ok: true });
    expect(b.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
    expect(b.row().frozenAt).toBeInstanceOf(Date);

    at(T0.getTime() + MINUTE);
    await b.plus.handleEvent(completed);
    await b.plus.handleEvent(plusInvoiceEvent('invoice.paid'));
    expect(b.row()).toMatchObject({
      plusSubscriptionId: 'sub_1',
      plusStatus: 'canceled',
    });
    expect(await b.wallet.hasPlus('org-1')).toBe(false);
    expect(grantsOf(b)).toHaveLength(0);
    expect(await b.wallet.balance('org-1')).toBe(0);
    // The hold notice only; never "Plus is on".
    expect(b.notifications.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('the same dispute twice cancels once', async () => {
    const b = disputedFirst();
    await b.billing.handleEvent(dispute);
    await b.billing.handleEvent(dispute);
    expect(b.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it('a failing cancel still freezes, so the later events never open Plus', async () => {
    const b = disputedFirst();
    (b.stripe.subscriptions.cancel as jest.Mock).mockRejectedValue(
      new Error('stripe down')
    );
    await expect(b.billing.handleEvent(dispute)).resolves.toEqual({ ok: true });
    await b.plus.handleEvent(completed);
    expect(b.row().plusStatus).toBe('active');
    expect(await b.wallet.hasPlus('org-1')).toBe(false);
    expect(grantsOf(b)).toHaveLength(0);
  });

  it('acts on it after an earlier subscription that ended', async () => {
    const b = disputedFirst({
      plusSubscriptionId: 'sub_old',
      plusStatus: 'canceled',
      plusPeriodEnd: new Date(T0.getTime() - DAY),
    });
    await b.billing.handleEvent(dispute);
    expect(b.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
    expect(b.row().frozenAt).toBeInstanceOf(Date);
  });
});

describe('The Plus card is the wallet card', () => {
  const event = (type: string, object: any, previous?: any) =>
    ({
      id: `evt_${type}`,
      type,
      data: { object, ...(previous ? { previous_attributes: previous } : {}) },
    } as any);
  const subscribed = event('customer.subscription.created', {
    id: 'sub_1',
    metadata: { service: 'wallet', kind: 'plus' },
  });
  // Stripe as it is: updating the subscription's card changes it there.
  const live = (b: ReturnType<typeof build>, over: Record<string, any> = {}) => {
    let sub = subscription(over);
    b.setSubscription(sub);
    b.stripe.subscriptions.update.mockImplementation(async (_id: string, p: any) => {
      sub = { ...sub, ...p };
      b.setSubscription(sub);
      return sub;
    });
  };
  const customerDefault = (b: ReturnType<typeof build>, id: string | null) =>
    (b.stripe.customers.retrieve as jest.Mock).mockResolvedValue({
      id: 'cus_1',
      metadata: { service: 'wallet' },
      invoice_settings: { default_payment_method: id },
    });

  it("saves the subscription's card on the first subscribe, once", async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    live(b, { default_payment_method: 'pm_sub1' });
    await b.plus.handleEvent(subscribed);
    await b.plus.handleEvent(subscribed);
    expect(b.row()).toMatchObject({
      paymentMethodId: 'pm_sub1',
      cardBrand: 'visa',
      cardLast4: 'sub1',
      cardExp: '12/2030',
      plusPaymentMethodId: 'pm_sub1',
    });
    const cardWrites = b.repo.updateWallet.mock.calls.filter(
      ([, data]: any) => 'paymentMethodId' in data
    );
    expect(cardWrites).toHaveLength(1);
    expect(b.stripe.paymentMethods.attach).not.toHaveBeenCalled();
    expect(walletAlert).not.toHaveBeenCalled();
  });

  it("falls back to the card that paid the invoice, then the customer's default", async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    live(b);
    b.stripe.invoicePayments.list.mockResolvedValueOnce({
      data: [{ payment: { payment_intent: { payment_method: 'pm_inv1' } } }],
    });
    await b.plus.syncSubscription('sub_1');
    expect(b.stripe.invoicePayments.list).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: `in_${Math.floor(T0.getTime() / 1000)}` })
    );
    expect(b.row().paymentMethodId).toBe('pm_inv1');

    const c = build();
    c.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    live(c);
    customerDefault(c, 'pm_cus1');
    await c.plus.syncSubscription('sub_1');
    expect(c.row()).toMatchObject({
      paymentMethodId: 'pm_cus1',
      plusPaymentMethodId: 'pm_cus1',
    });
  });

  it('attaches a card that is on no customer yet', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    live(b, { default_payment_method: 'pm_sub1' });
    b.stripe.paymentMethods.retrieve.mockResolvedValueOnce(
      card('pm_sub1', { customer: null }) as any
    );
    await b.plus.syncSubscription('sub_1');
    expect(b.stripe.paymentMethods.attach).toHaveBeenCalledWith('pm_sub1', {
      customer: 'cus_1',
    });
    expect(b.row().paymentMethodId).toBe('pm_sub1');
  });

  it('keeps a card the wallet already has', async () => {
    const b = build();
    b.setWallet({
      stripeCustomerId: 'cus_1',
      frozenAt: null,
      paymentMethodId: 'pm_own1',
      cardLast4: 'own1',
      cardExp: '12/2030',
    });
    live(b, { default_payment_method: 'pm_sub1' });
    await b.plus.syncSubscription('sub_1');
    expect(b.row()).toMatchObject({
      paymentMethodId: 'pm_own1',
      cardLast4: 'own1',
      plusPaymentMethodId: 'pm_sub1',
    });
  });

  it('replaces a saved card that expired or is gone', async () => {
    for (const [name, over, setup] of [
      ['expired', { cardExp: '10/2026' }, () => undefined],
      [
        'detached',
        {},
        (b: ReturnType<typeof build>) =>
          b.stripe.paymentMethods.retrieve.mockResolvedValueOnce(
            card('pm_own1', { customer: null }) as any
          ),
      ],
      [
        'deleted',
        {},
        (b: ReturnType<typeof build>) =>
          b.stripe.paymentMethods.retrieve.mockRejectedValueOnce(
            Object.assign(new Error('No such PaymentMethod'), {
              code: 'resource_missing',
            })
          ),
      ],
    ] as const) {
      const b = build();
      b.setWallet({
        stripeCustomerId: 'cus_1',
        frozenAt: null,
        paymentMethodId: 'pm_own1',
        cardExp: '12/2030',
        ...over,
      });
      live(b, { default_payment_method: 'pm_sub1' });
      (setup as (b: any) => void)(b);
      await b.plus.syncSubscription('sub_1');
      expect([name, b.row().paymentMethodId]).toEqual([name, 'pm_sub1']);
    }
  });

  it('a card changed in the billing portal becomes the wallet card and the renewal card, once', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    live(b, { default_payment_method: 'pm_sub1' });
    await b.plus.syncSubscription('sub_1');
    // The portal sets the customer's default card.
    customerDefault(b, 'pm_new1');
    const portal = event(
      'customer.updated',
      { id: 'cus_1', metadata: { service: 'wallet', organizationId: 'org-1' } },
      { invoice_settings: { default_payment_method: null } }
    );
    expect(await b.plus.handleEvent(portal)).toEqual({ ok: true });
    expect(await b.plus.handleEvent(portal)).toEqual({ ok: true });
    expect(b.row()).toMatchObject({
      paymentMethodId: 'pm_new1',
      cardLast4: 'new1',
      plusPaymentMethodId: 'pm_new1',
    });
    expect(b.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(b.stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      default_payment_method: 'pm_new1',
    });
    expect(b.stripe.customers.update).toHaveBeenCalledWith('cus_1', {
      invoice_settings: { default_payment_method: 'pm_new1' },
    });

    // The portal may set the subscription's card instead.
    b.setSubscription(
      subscription({ default_payment_method: 'pm_new2' })
    );
    await b.plus.handleEvent(
      event('customer.subscription.updated', {
        id: 'sub_1',
        metadata: { service: 'wallet', kind: 'plus' },
      })
    );
    expect(b.row()).toMatchObject({
      paymentMethodId: 'pm_new2',
      plusPaymentMethodId: 'pm_new2',
    });
  });

  it("ignores other customers' updates and updates that are not the card", async () => {
    const b = build();
    b.setWallet(plusWallet({ plusPaymentMethodId: 'pm_sub1' }));
    expect(
      await b.plus.handleEvent(
        event('customer.updated', { id: 'cus_x', metadata: {} }, { email: 'a' })
      )
    ).toBeUndefined();
    expect(
      await b.plus.handleEvent(
        event(
          'customer.updated',
          { id: 'cus_1', metadata: { service: 'wallet' } },
          { email: 'a' }
        )
      )
    ).toEqual({ ok: true });
    expect(b.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("a card saved in the wallet becomes the subscription's card", async () => {
    const b = build();
    b.setWallet(plusWallet({ paymentMethodId: 'pm_old1', plusPaymentMethodId: 'pm_old1' }));
    live(b, { default_payment_method: 'pm_old1' });
    (b.stripe as any).setupIntents = {
      retrieve: jest.fn(async () => ({
        status: 'succeeded',
        payment_method: card('pm_set1'),
      })),
    };
    const setup = event('checkout.session.completed', {
      id: 'cs_1',
      mode: 'setup',
      status: 'complete',
      customer: 'cus_1',
      setup_intent: 'seti_1',
      metadata: { service: 'wallet', kind: 'card', organizationId: 'org-1' },
    });
    expect(await b.plus.handleEvent(setup)).toBeUndefined();
    await b.billing.handleEvent(setup);
    await b.billing.handleEvent(setup);
    expect(b.row()).toMatchObject({
      paymentMethodId: 'pm_set1',
      plusPaymentMethodId: 'pm_set1',
    });
    expect(b.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(b.stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      default_payment_method: 'pm_set1',
    });
    // Stripe's own event about it changes nothing more.
    customerDefault(b, 'pm_set1');
    await b.plus.handleEvent(subscribed);
    expect(b.row().paymentMethodId).toBe('pm_set1');
    expect(b.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  it('a new subscription after Plus ended takes its card as a first one', async () => {
    const b = build();
    b.setWallet(
      plusWallet({
        plusSubscriptionId: 'sub_old',
        plusStatus: 'canceled',
        plusPaymentMethodId: 'pm_old1',
        paymentMethodId: 'pm_own1',
        cardExp: '12/2030',
      })
    );
    live(b, { default_payment_method: 'pm_sub1' });
    await b.plus.syncSubscription('sub_1');
    // The wallet's working card stays; the new subscription's is recorded.
    expect(b.row()).toMatchObject({
      plusSubscriptionId: 'sub_1',
      paymentMethodId: 'pm_own1',
      plusPaymentMethodId: 'pm_sub1',
    });
    expect(b.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('a change to a non-card, or to a card it cannot keep, is recorded once and leaves the wallet card', async () => {
    const b = build();
    b.setWallet(
      plusWallet({ paymentMethodId: 'pm_own1', plusPaymentMethodId: 'pm_own1' })
    );
    live(b, { default_payment_method: 'pm_link1' });
    b.stripe.paymentMethods.retrieve.mockResolvedValueOnce({
      id: 'pm_link1',
      type: 'link',
      customer: 'cus_1',
    } as any);
    await b.plus.handleEvent(subscribed);
    await b.plus.handleEvent(subscribed);
    expect(b.row()).toMatchObject({
      paymentMethodId: 'pm_own1',
      plusPaymentMethodId: 'pm_link1',
    });
    expect(b.stripe.paymentMethods.retrieve).toHaveBeenCalledTimes(1);

    // A first card Stripe refuses to attach: alerted once, then left.
    const c = build();
    c.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    live(c, { default_payment_method: 'pm_sub1' });
    c.stripe.paymentMethods.retrieve.mockResolvedValue(
      card('pm_sub1', { customer: null }) as any
    );
    c.stripe.paymentMethods.attach.mockRejectedValue(
      Object.assign(new Error('cannot be attached'), {
        type: 'StripeInvalidRequestError',
      })
    );
    await c.plus.handleEvent(subscribed);
    await c.plus.handleEvent(subscribed);
    expect(c.row().plusPaymentMethodId).toBe('pm_sub1');
    expect(c.row().paymentMethodId).toBeUndefined();
    expect(walletAlert).toHaveBeenCalledTimes(1);
  });

  it('a card saved from the auto top-up switch turns auto top-up on', async () => {
    const b = build();
    b.setWallet(plusWallet({ autoTopUp: false }));
    live(b);
    (b.stripe as any).setupIntents = {
      retrieve: jest.fn(async () => ({
        status: 'succeeded',
        payment_method: card('pm_set1'),
      })),
    };
    await b.billing.createCardSetup({
      organizationId: 'org-1',
      autoTopUp: true,
      returnUrl: 'x',
    });
    const params = (b.stripe.checkout.sessions.create as jest.Mock).mock
      .calls[0][0];
    expect(params.metadata.autoTopUp).toBe('1');
    await b.billing.handleEvent(
      event('checkout.session.completed', {
        id: 'cs_1',
        mode: 'setup',
        status: 'complete',
        customer: 'cus_1',
        setup_intent: 'seti_1',
        metadata: params.metadata,
      })
    );
    expect(b.row()).toMatchObject({
      paymentMethodId: 'pm_set1',
      autoTopUp: true,
    });
  });

  it('never throws when Stripe or the database fails on the card', async () => {
    const b = build();
    b.setWallet({ stripeCustomerId: 'cus_1', frozenAt: null });
    live(b, { default_payment_method: 'pm_sub1' });
    (b.stripe.customers.retrieve as jest.Mock).mockRejectedValueOnce(
      new Error('stripe down')
    );
    await expect(b.plus.handleEvent(subscribed)).resolves.toEqual({ ok: true });
    // Plus is recorded all the same; the card comes with the next event.
    expect(b.row().plusSubscriptionId).toBe('sub_1');
    expect(b.row().paymentMethodId).toBeUndefined();
    expect(walletAlert).toHaveBeenCalledTimes(1);
    await b.plus.handleEvent(subscribed);
    expect(b.row().paymentMethodId).toBe('pm_sub1');

    // The wallet card's push to the subscription failing never throws.
    b.stripe.subscriptions.update.mockRejectedValueOnce(new Error('stripe down'));
    await expect(b.billing.cardForPlus('org-1', 'pm_set2')).resolves.toBeUndefined();
    expect(b.row().plusPaymentMethodId).toBe('pm_sub1');
    expect(walletAlert).toHaveBeenCalledTimes(2);

    // Nor does the database failing on a portal update.
    b.repo.getWalletByCustomer.mockRejectedValueOnce(new Error('db down'));
    await expect(
      b.plus.handleEvent(
        event(
          'customer.updated',
          { id: 'cus_1', metadata: { service: 'wallet' } },
          { invoice_settings: {} }
        )
      )
    ).resolves.toEqual({ ok: true });
    expect(walletAlert).toHaveBeenCalledTimes(3);
  });
});

describe('Auto top-up with Plus', () => {
  const event = (type: string, object: any) =>
    ({ id: `evt_${type}`, type, data: { object } } as any);
  const autoWallet = (over: Record<string, any> = {}) =>
    plusWallet({
      autoTopUp: true,
      paymentMethodId: 'pm_1',
      autoTopUpAmount: 1000,
      autoTopUpMonthlyCap: 5000,
      // 100 credits.
      autoTopUpThreshold: 10000,
      ...over,
    });
  const charges = (b: ReturnType<typeof build>) => {
    const create = jest.fn(async (params: any) => ({
      id: `pi_${create.mock.calls.length}`,
      status: 'succeeded',
      amount: params.amount,
      amount_received: params.amount,
      currency: params.currency,
      metadata: params.metadata,
    }));
    (b.stripe.paymentIntents as any).create = create;
    return create;
  };

  it('tops up from the card on active Plus', async () => {
    const b = build();
    // Under 500 credits: the 400 plan credits are not enough.
    b.setWallet(autoWallet({ autoTopUpThreshold: 50000 }));
    const create = charges(b);
    expect(await b.billing.autoTopUp('org-1')).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000,
        customer: 'cus_1',
        payment_method: 'pm_1',
        off_session: true,
      }),
      expect.anything()
    );
  });

  it('never charges the card while the Plus payment is failing', async () => {
    const b = build();
    b.setWallet(autoWallet({ plusStatus: 'past_due' }));
    const create = charges(b);
    expect(await b.billing.autoTopUp('org-1', 5000)).toBe(false);
    expect(await b.wallet.autoTopUpHeadroom('org-1')).toBe(0);
    expect(create).not.toHaveBeenCalled();
    // It is paused, not off: a paid renewal brings it back.
    expect(b.row().autoTopUp).toBe(true);
  });

  it('turns off when Plus ends, says why, once', async () => {
    const b = build();
    b.setWallet(autoWallet());
    b.setSubscription(
      subscription({
        status: 'canceled',
        ended_at: Math.floor((T0.getTime() + 30 * DAY) / 1000),
      })
    );
    const ended = event('customer.subscription.deleted', {
      id: 'sub_1',
      metadata: { service: 'wallet', kind: 'plus' },
    });
    await b.plus.handleEvent(ended);
    await b.plus.handleEvent(ended);
    expect(b.row()).toMatchObject({
      autoTopUp: false,
      autoTopUpOffReason: 'plus_ended',
      autoTopUpOffAt: T0,
    });
    const off = b.notifications.inAppNotification.mock.calls.filter(
      (c: any[]) => c[1] === 'Automatic top-up turned off'
    );
    expect(off).toHaveLength(1);
    expect(off[0][2]).toMatch(/Plus subscription ended/);
  });

  it('a card that fails says so too', async () => {
    const b = build();
    b.setWallet(autoWallet({ autoTopUpThreshold: 50000 }));
    (b.stripe.paymentIntents as any).create = jest.fn(async () => {
      throw Object.assign(new Error('declined'), { type: 'StripeCardError', code: 'card_declined' });
    });
    expect(await b.billing.autoTopUp('org-1')).toBe(false);
    expect(b.row()).toMatchObject({ autoTopUp: false, autoTopUpOffReason: 'card_failed' });
  });

  it('turning it off when Plus ends never throws', async () => {
    const b = build();
    b.setWallet(autoWallet());
    b.setSubscription(subscription({ status: 'canceled' }));
    jest
      .spyOn(b.billing, 'disableAutoTopUp')
      .mockRejectedValueOnce(new Error('db down'));
    await expect(b.plus.syncSubscription('sub_1')).resolves.toBeUndefined();
    expect(walletAlert).toHaveBeenCalledTimes(1);
  });

  it('triggers on the whole balance, plan and top-up credits together', async () => {
    const b = build();
    b.setWallet(autoWallet());
    await b.wallet.syncPlan('org-1');
    b.add({ type: 'TOPUP', amount: 3000, idempotencyKey: 'topup:pi_x' });
    const create = charges(b);
    // 400 plan + 30 top-up credits: above the 100-credit threshold.
    expect(await b.billing.autoTopUp('org-1')).toBe(false);
    // 350 plan credits spent: 50 plan + 30 top-up = 80, under 100.
    b.add({ type: 'SPEND', amount: -35000 });
    expect(await b.billing.autoTopUp('org-1')).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never counts plan credits whose period ended', async () => {
    const b = build();
    b.setWallet(autoWallet());
    await b.wallet.syncPlan('org-1');
    b.add({ type: 'TOPUP', amount: 3000, idempotencyKey: 'topup:pi_x' });
    const create = charges(b);
    // The next span has started and its invoice is not paid yet: last
    // period's 400 plan credits are gone, 30 top-up credits are left.
    at(T0.getTime() + 30 * DAY + HOUR);
    b.setWallet(
      autoWallet({
        plusPeriodStart: new Date(T0.getTime() + 30 * DAY),
        plusPeriodEnd: new Date(T0.getTime() + 60 * DAY),
        plusPaidPeriodStart: T0,
      })
    );
    expect(await b.billing.autoTopUp('org-1')).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(b.entries.some((e) => e.type === 'PLAN_EXPIRE')).toBe(true);
  });
});
