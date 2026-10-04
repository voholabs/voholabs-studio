import {
  BILLING,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';

// WalletService against a plain stub repository: settings and price rows in
// memory, no database.

const SETTINGS: Record<string, string> = {
  [BILLING.currency]: 'USD',
  [BILLING.creditsPerUnit]: '100',
  [BILLING.defaultMultiplierBp]: '15000',
  [BILLING.minTopUp]: '1000',
  [BILLING.topUpOptions]: '500,1000,2500,5000',
};

const row = (over: Record<string, any> = {}) => ({
  key: 'x.post',
  provider: 'x',
  category: 'channels',
  name: 'Post on X',
  description: null,
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
  ...over,
});

const ACTIONS = [
  row(),
  row({
    key: 'x.post_link',
    name: 'Post on X with a link',
    costMicros: 200000,
  }),
  row({
    key: 'x.post_read',
    name: 'Read a post',
    unit: 'read',
    costMicros: 5000,
  }),
  row({
    key: 'storage.gb',
    provider: 'storage',
    category: 'storage',
    unit: 'gb',
    billing: 'MONTHLY',
    fixedPrice: 5000,
    requiresTopUp: false,
  }),
];

const stubRepo = (
  over: Record<string, any> = {},
  settings: Record<string, string> = SETTINGS,
  actions: any[] = ACTIONS
) =>
  ({
    settings: jest.fn(async () =>
      Object.entries(settings).map(([key, value]) => ({ key, value }))
    ),
    actions: jest.fn(async () => actions),
    categories: jest.fn(async () => []),
    balance: jest.fn(async () => 0),
    getWallet: jest.fn(async () => null),
    autoTopUpSpentSince: jest.fn(async () => 0),
    scheduledPosts: jest.fn(async () => []),
    spend: jest.fn(async (entry: any) => entry),
    ...over,
  } as any);

describe('WalletService.priceOf', () => {
  const service = new WalletService(stubRepo());

  it('uses fixedPrice as is when the row has one', async () => {
    expect(
      await service.priceOf(
        row({ fixedPrice: 5000, costMicros: 999999 }) as any
      )
    ).toBe(5000);
  });

  it('uses a fixedPrice of zero instead of the cost maths', async () => {
    expect(await service.priceOf(row({ fixedPrice: 0 }) as any)).toBe(0);
  });

  it('prices $0.015 at x1.5 and 100 credits per dollar at 2.25 credits (225)', async () => {
    expect(await service.priceOf(row({ costMicros: 15000 }) as any)).toBe(225);
  });

  it('prices $0.005 at 0.75 credits (75)', async () => {
    expect(await service.priceOf(row({ costMicros: 5000 }) as any)).toBe(75);
  });

  it('prices $0.20 at 30.00 credits (3000)', async () => {
    expect(await service.priceOf(row({ costMicros: 200000 }) as any)).toBe(
      3000
    );
  });

  it('rounds up to the next 0.01 credit', async () => {
    // $0.000001 x 1.5 x 100 x 100 = 0.015 units -> 1
    expect(await service.priceOf(row({ costMicros: 1 }) as any)).toBe(1);
    // $0.0151 -> 226.5 -> 227
    expect(await service.priceOf(row({ costMicros: 15100 }) as any)).toBe(227);
  });

  it('uses the row multiplier over the default one', async () => {
    expect(
      await service.priceOf(
        row({ costMicros: 15000, multiplierBp: 20000 }) as any
      )
    ).toBe(300);
  });

  it('treats a cost in the wallet currency as fx 1, in any letter case', async () => {
    expect(
      await service.priceOf(
        row({ costCurrency: 'usd', costMicros: 15000 }) as any
      )
    ).toBe(225);
  });

  it('converts a foreign cost with its fx setting', async () => {
    const fx = new WalletService(
      stubRepo({}, { ...SETTINGS, 'fx.EUR': '0.8' })
    );
    expect(
      await fx.priceOf(row({ costCurrency: 'EUR', costMicros: 15000 }) as any)
    ).toBe(180);
  });

  it('throws when a foreign cost has no exchange rate', async () => {
    await expect(
      service.priceOf(row({ costCurrency: 'GBP' }) as any)
    ).rejects.toThrow('No exchange rate for GBP');
  });

  it('throws when a setting the maths needs is missing', async () => {
    const { [BILLING.defaultMultiplierBp]: _, ...rest } = SETTINGS;
    const missing = new WalletService(stubRepo({}, rest));
    await expect(missing.priceOf(row() as any)).rejects.toThrow(
      `Billing setting ${BILLING.defaultMultiplierBp} is not configured`
    );
  });
});

describe('WalletService.price and charge', () => {
  it('returns undefined for an unknown or inactive action', async () => {
    const service = new WalletService(
      stubRepo({}, SETTINGS, [...ACTIONS, row({ key: 'x.old', active: false })])
    );
    expect(await service.price('nope')).toBeUndefined();
    expect(await service.price('x.old')).toBeUndefined();
    expect((await service.price('x.post'))?.price).toBe(225);
  });

  it('refuses to charge an action that has no price', async () => {
    const repo = stubRepo();
    const service = new WalletService(repo);
    await expect(
      service.charge({ organizationId: 'o', actionKey: 'nope', chargeKey: 'k' })
    ).rejects.toThrow('No price for nope');
    expect(repo.spend).not.toHaveBeenCalled();
  });

  it('charges price x quantity with the unit price and passes allowNegative on', async () => {
    const repo = stubRepo();
    const service = new WalletService(repo);
    await service.charge({
      organizationId: 'o',
      actionKey: 'x.post_read',
      chargeKey: 'reads:1',
      quantity: 4,
      allowNegative: true,
    });
    expect(repo.spend).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 300,
        unitPrice: 75,
        quantity: 4,
        type: 'SPEND',
        chargeKey: 'reads:1',
        allowNegative: true,
        description: 'Read a post',
      })
    );
  });

  it('caches settings and price rows between calls', async () => {
    const repo = stubRepo();
    const service = new WalletService(repo);
    await service.price('x.post');
    await service.price('x.post_link');
    expect(repo.settings).toHaveBeenCalledTimes(1);
    expect(repo.actions).toHaveBeenCalledTimes(1);
  });
});

describe('WalletService.topUpRules', () => {
  it('drops suggested amounts below the minimum', async () => {
    const service = new WalletService(stubRepo());
    expect(await service.topUpRules()).toEqual({
      minAmount: 1000,
      options: [1000, 2500, 5000],
      creditsPerUnit: 100,
    });
  });
});

describe('WalletService.forecast and estimate', () => {
  const posts = [
    {
      id: 'p1',
      content: '<p>Hello there</p>',
      publishDate: new Date('2026-10-04T10:00:00Z'),
      integration: { providerIdentifier: 'x' },
    },
    {
      id: 'p2',
      content: '<p>Read example.com today</p>',
      publishDate: new Date('2026-10-04T12:00:00Z'),
      integration: { providerIdentifier: 'x' },
    },
  ];

  const build = (wallet: any = null, balance = 1000, over: any = {}) => {
    const repo = stubRepo({
      balance: jest.fn(async () => balance),
      getWallet: jest.fn(async () => wallet),
      scheduledPosts: jest.fn(async () => posts),
      ...over,
    });
    const service = new WalletService(repo);
    jest.spyOn(service, 'paysFromWallet').mockResolvedValue(true);
    return { service, repo };
  };

  const autoWallet = (over: any = {}) => ({
    autoTopUp: true,
    frozenAt: null,
    paymentMethodId: 'pm_1',
    autoTopUpAmount: 1000,
    autoTopUpMonthlyCap: null,
    ...over,
  });

  afterEach(() => {
    delete process.env.STRIP_LINKS_FROM_X_POSTS;
  });

  it('is empty for a workspace that does not pay from its wallet', async () => {
    const { service, repo } = build();
    (service.paysFromWallet as jest.Mock).mockResolvedValue(false);
    expect(await service.forecast('o')).toEqual({
      windowHours: 48,
      needed: 0,
      short: false,
      items: [],
    });
    expect(repo.scheduledPosts).not.toHaveBeenCalled();
  });

  it('prices each scheduled post, a bare domain at the link rate', async () => {
    const { service } = build();
    const forecast = await service.forecast('o');
    expect(forecast.items.map((i) => i.actionKey)).toEqual([
      'x.post',
      'x.post_link',
    ]);
    expect(forecast.items[1].postId).toBe('p2');
    expect(forecast.needed).toBe(3225);
    expect(forecast.short).toBe(true);
  });

  it('is not short when auto top-up has no monthly limit', async () => {
    const { service } = build(autoWallet());
    expect(await service.autoTopUpHeadroom('o')).toBe(Infinity);
    expect((await service.forecast('o')).short).toBe(false);
  });

  it('counts only whole auto top-ups left under the monthly limit', async () => {
    const { service } = build(autoWallet({ autoTopUpMonthlyCap: 2500 }), 1000, {
      autoTopUpSpentSince: jest.fn(async () => 2000),
    });
    // 500 cents left under the cap, less than one 1000-cent top-up.
    expect(await service.autoTopUpHeadroom('o')).toBe(0);
    expect((await service.forecast('o')).short).toBe(true);
  });

  it('gives no headroom when the wallet is frozen or has no card', async () => {
    expect(
      await build(
        autoWallet({ frozenAt: new Date() })
      ).service.autoTopUpHeadroom('o')
    ).toBe(0);
    expect(
      await build(
        autoWallet({ paymentMethodId: null })
      ).service.autoTopUpHeadroom('o')
    ).toBe(0);
  });

  it('prices a post whose link is stripped before sending as a plain post', async () => {
    process.env.STRIP_LINKS_FROM_X_POSTS = 'true';
    const { service } = build(null, 1000, {
      scheduledPosts: jest.fn(async () => [
        { ...posts[0], content: '<p>See https://example.com/a</p>' },
      ]),
    });
    expect((await service.forecast('o')).items[0].actionKey).toBe('x.post');
  });

  it('estimate reports the price, the balance after it, and short with scheduled usage counted', async () => {
    const { service } = build(null, 3500);
    expect(await service.estimate('o', 'x.post', 2)).toEqual({
      price: 450,
      balanceAfter: 3050,
      // 450 + 3225 scheduled > 3500
      short: true,
    });
  });

  it('estimate is undefined for an action without a price', async () => {
    const { service } = build();
    expect(await service.estimate('o', 'nope')).toBeUndefined();
  });
});
