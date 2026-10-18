jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert',
  () => ({ walletAlert: jest.fn(async () => undefined) })
);

import {
  BILLING,
  usageChargeKey,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { WalletUsageTool } from '@gitroom/nestjs-libraries/chat/tools/wallet.usage.tool';

// Usage-priced rows (AI image and voice-over generation through the MCP
// gateway): WalletService's quote and price, and the walletUsage tool, with
// stub repositories. Nothing leaves the process.

const SETTINGS: Record<string, string> = {
  [BILLING.currency]: 'USD',
  [BILLING.creditsPerUnit]: '20',
  [BILLING.defaultMultiplierBp]: '15000',
  [BILLING.minTopUp]: '500',
};

const row = (over: Record<string, any> = {}) => ({
  key: 'ai.image',
  provider: 'ai',
  category: 'ai',
  name: 'AI image',
  description: null,
  unit: 'image',
  costMicros: 84000,
  costCurrency: 'USD',
  multiplierBp: null,
  fixedPrice: null,
  freeUnits: null,
  freePeriod: null,
  billing: 'PER_USE',
  requiresTopUp: false,
  active: true,
  ...over,
});

const ACTIONS = [
  row(),
  row({
    key: 'ai.speech',
    name: 'AI voice-over',
    unit: '1k_chars',
    costMicros: 157500,
  }),
  row({
    key: 'data.run',
    provider: 'data',
    category: 'data',
    name: 'Data run',
    unit: 'dollar_of_data',
    costMicros: 1000000,
    requiresTopUp: true,
  }),
  row({
    key: 'x.post',
    provider: 'x',
    category: 'channels',
    name: 'Post on X',
    unit: 'post',
    costMicros: 15000,
    requiresTopUp: true,
  }),
];

const stubRepo = (over: Record<string, any> = {}) =>
  ({
    settings: jest.fn(async () =>
      Object.entries(SETTINGS).map(([key, value]) => ({ key, value }))
    ),
    actions: jest.fn(async () => ACTIONS),
    balance: jest.fn(async () => 2000),
    getWallet: jest.fn(async () => null),
    autoTopUpSpentSince: jest.fn(async () => 0),
    usedUnits: jest.fn(async () => 0),
    spend: jest.fn(async (entry: any) => ({
      ...entry,
      amount: -entry.amount,
      idempotencyKey: `${entry.chargeKey}#1`,
    })),
    ...over,
  } as any);

const service = (over: Record<string, any> = {}) => {
  const repo = stubRepo(over);
  return { repo, wallet: new WalletService(repo, {} as any) };
};

const PAID = {
  id: 'org-1',
  subscription: { subscriptionTier: 'ULTIMATE', cancelAt: null },
};
const FREE = {
  id: 'org-1',
  subscription: { subscriptionTier: 'FREE', cancelAt: '2020-01-01' },
};

const context = (org: any) => {
  const store = new Map<string, string>();
  return {
    mcp: { extra: { authInfo: org } },
    requestContext: {
      set: (key: string, value: string) => store.set(key, value),
      get: (key: string) => store.get(key),
    },
  };
};

// The tool with WalletBillingService.charge standing in for the billing
// service (auto top-up is its own spec), charging through the real
// WalletService.
const tool = (over: Record<string, any> = {}) => {
  const { repo, wallet } = service(over);
  const billing = {
    charge: jest.fn((params: any) => wallet.charge(params)),
    autoTopUpFor: jest.fn(async () => false),
  };
  return {
    repo,
    billing,
    run: (input: any, org: any = FREE) =>
      (new WalletUsageTool(wallet, billing as any).run() as any).execute(
        input,
        context(org)
      ),
  };
};

describe('WalletService usage pricing', () => {
  it('prices an image at cost x1.5 at 20 credits per dollar: $0.084 is 2.52 credits', async () => {
    const { wallet } = service();
    const action = (await wallet.usageAction('ai.image'))!;
    expect(await wallet.usagePrice(action, 1)).toBe(252);
  });

  it('prices speech by the share of 1k characters, rounded up once', async () => {
    const { wallet } = service();
    const action = (await wallet.usageAction('ai.speech'))!;
    // 1,000 characters: $0.1575 -> 4.725 -> 4.73 credits
    expect(await wallet.usagePrice(action, 1)).toBe(473);
    // 350 characters: $0.055125 -> 1.65375 -> 1.66 credits
    expect(await wallet.usagePrice(action, 0.35)).toBe(166);
  });

  it("uses the provider's reported cost with the row's markup", async () => {
    const { wallet } = service();
    const action = (await wallet.usageAction('ai.image'))!;
    // $0.04 -> 1.20 credits
    expect(await wallet.usagePrice(action, 1, 40000)).toBe(120);
  });

  it('locks a row that needs a top-up until the first top-up', async () => {
    const { wallet } = service();
    expect(await wallet.quoteUsage('org-1', 'data.run', 0.1)).toMatchObject({
      locked: true,
    });
    const topped = service({
      getWallet: jest.fn(async () => ({ firstTopUpAt: new Date() })),
    }).wallet;
    expect(await topped.quoteUsage('org-1', 'data.run', 0.1)).toMatchObject({
      locked: false,
      short: false,
    });
    expect(await wallet.quoteUsage('org-1', 'ai.image', 1)).toMatchObject({
      locked: false,
    });
    expect(await wallet.usageAction('nothing')).toBeUndefined();
  });

  it('quotes against the balance, granted credits included (no top-up needed)', async () => {
    const { wallet } = service({ balance: jest.fn(async () => 300) });
    expect(await wallet.quoteUsage('org-1', 'ai.image', 1)).toMatchObject({
      price: 252,
      balance: 300,
      short: false,
      frozen: false,
    });
    const low = service({ balance: jest.fn(async () => 100) }).wallet;
    expect(await low.quoteUsage('org-1', 'ai.image', 1)).toMatchObject({
      short: true,
    });
  });
});

describe('walletUsage tool', () => {
  it('quotes a free workspace with credits, without a top-up', async () => {
    const { run } = tool({ balance: jest.fn(async () => 2000) });
    expect(
      await run({ action: 'quote', actionKey: 'ai.image', units: 1 })
    ).toEqual({
      ok: true,
      paidPlan: false,
      price: 2.52,
      balance: 20,
      // The live rates, so the gateway prices with what Studio charges.
      rates: {
        currency: 'USD',
        creditsPerUnit: 20,
        defaultMultiplierBp: 15000,
        defaultMultiplier: 1.5,
      },
    });
  });

  // Without Plus a short balance cannot be topped up, so it points at Plus.
  it('refuses with the wallet 402 shape when the balance is short', async () => {
    const { run } = tool({ balance: jest.fn(async () => 100) });
    const result = await run({
      action: 'quote',
      actionKey: 'ai.image',
      units: 1,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 402,
      wallet: true,
      price: 2.52,
      balance: 1,
    });
    expect(result.url).toMatch(/\/plus$/);
    expect(result.message).toMatch(/Not enough credits.*Get Plus/);
  });

  it('refuses a frozen wallet', async () => {
    const { run } = tool({
      getWallet: jest.fn(async () => ({ frozenAt: new Date() })),
    });
    const result = await run({
      action: 'quote',
      actionKey: 'ai.image',
      units: 1,
    });
    expect(result).toMatchObject({ ok: false, wallet: true, status: 402 });
    expect(result.message).toMatch(/on hold/);
  });

  it('charges what was made once per idempotency key, into a negative balance if need be', async () => {
    const { run, repo } = tool({ balance: jest.fn(async () => 0) });
    const result = await run({
      action: 'charge',
      actionKey: 'ai.speech',
      units: 0.35,
      idempotencyKey: 'call-123456',
    });
    expect(result).toMatchObject({ ok: true, paidPlan: false, charged: 1.66 });
    expect(repo.spend).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actionKey: 'ai.speech',
        amount: 166,
        unitPrice: 166,
        quantity: 1,
        chargeKey: usageChargeKey('org-1', 'ai.speech', 'call-123456'),
        allowNegative: true,
      })
    );
  });

  it("charges the provider's reported cost when given", async () => {
    const { run, repo } = tool();
    await run({
      action: 'charge',
      actionKey: 'ai.image',
      units: 1,
      costUsd: 0.04,
      idempotencyKey: 'call-abcdefgh',
    });
    expect(repo.spend).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 120 })
    );
  });

  it('needs an idempotency key to charge', async () => {
    const { run, repo } = tool();
    const result = await run({
      action: 'charge',
      actionKey: 'ai.image',
      units: 1,
    });
    expect(result.ok).toBe(false);
    expect(repo.spend).not.toHaveBeenCalled();
  });

  it('refuses a row that needs Plus without it, welcome credits or not', async () => {
    const { run, repo } = tool({ balance: jest.fn(async () => 2000) });
    for (const actionKey of ['x.post', 'data.run']) {
      for (const action of ['quote', 'charge']) {
        const result = await run({
          action,
          actionKey,
          units: 1,
          idempotencyKey: 'call-xxxxxxxx',
        });
        expect(result).toMatchObject({
          ok: false,
          status: 402,
          wallet: true,
          locked: true,
          reason: 'plus',
          topUpRequired: true,
        });
        expect(result.upgradeUrl).toMatch(/\/plus$/);
        expect(result.url).toMatch(/\/plus$/);
        expect(result.message).toMatch(/included with Plus/);
      }
    }
    expect(repo.spend).not.toHaveBeenCalled();
  });

  it('quotes and charges a row that needs a top-up once the workspace has topped up', async () => {
    const { run, repo } = tool({
      getWallet: jest.fn(async () => ({ firstTopUpAt: new Date() })),
    });
    expect(
      await run({ action: 'quote', actionKey: 'data.run', units: 0.1 })
    ).toMatchObject({ ok: true, price: 3 });
    await run({
      action: 'charge',
      actionKey: 'data.run',
      units: 0.1,
      costUsd: 0.05,
      idempotencyKey: 'call-datarun1',
    });
    // $0.05 reported -> 1.5 x 20 x 0.05 = 1.50 credits
    expect(repo.spend).toHaveBeenCalledWith(
      expect.objectContaining({ actionKey: 'data.run', amount: 150 })
    );
  });

  it('leaves a paid plan alone: never charged, never reads the wallet', async () => {
    const { run, repo, billing } = tool();
    for (const action of ['quote', 'charge']) {
      expect(
        await run(
          {
            action,
            actionKey: 'ai.image',
            units: 1,
            idempotencyKey: 'call-paidplan',
          },
          PAID
        )
      ).toEqual({ ok: true, paidPlan: true, price: 0, charged: 0 });
    }
    expect(billing.charge).not.toHaveBeenCalled();
    expect(repo.balance).not.toHaveBeenCalled();
  });
});
