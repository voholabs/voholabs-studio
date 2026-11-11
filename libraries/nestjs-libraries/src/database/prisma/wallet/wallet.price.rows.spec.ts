import {
  priceRevisionKey,
  SHIPPED_PRICE_ROWS,
  WalletPriceRowsService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.price.rows.service';

// The price rows the code ships with: added once, never overwritten; a
// revision only when listed in WALLET_PRICE_REVISIONS, and only once.
const repo = () => {
  const actions = new Map<string, any>([
    ['ai.music', { key: 'ai.music', costMicros: 9999 }],
    ['ai.speech', { key: 'ai.speech', costMicros: 157500 }],
    ['ai.speech.clone', { key: 'ai.speech.clone', costMicros: 80000 }],
  ]);
  const settings = new Map<string, string>();
  return {
    actions,
    settings,
    createActionIfMissing: jest.fn(async (row: any) => {
      if (!actions.has(row.key)) {
        actions.set(row.key, { ...row });
      }
      return { key: row.key };
    }),
    setActionCost: jest.fn(async (key: string, costMicros: number) => {
      if (actions.has(key)) {
        actions.get(key).costMicros = costMicros;
      }
      return { count: 1 };
    }),
    setting: jest.fn(async (key: string) =>
      settings.has(key) ? { key, value: settings.get(key) } : null
    ),
    saveSetting: jest.fn(async (key: string, value: string) => {
      settings.set(key, value);
      return { key, value };
    }),
  };
};

describe('WalletPriceRowsService', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('ships the music, sound and flows rows', () => {
    expect(SHIPPED_PRICE_ROWS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'ai.music',
          unit: 'second',
          costMicros: 2500,
          requiresTopUp: false,
          billing: 'PER_USE',
        }),
        expect.objectContaining({
          key: 'ai.sound',
          unit: 'second',
          costMicros: 2000,
          requiresTopUp: false,
          billing: 'PER_USE',
        }),
        expect.objectContaining({
          provider: 'flows',
          billing: 'UNLOCK',
          requiresTopUp: true,
        }),
      ])
    );
  });

  it('adds missing rows and leaves existing ones as they are', async () => {
    process.env = { ...OLD_ENV, WALLET_PRICE_REVISIONS: '' };
    const wallet = repo();
    await new WalletPriceRowsService(wallet as any).sync();
    expect(wallet.actions.get('ai.music').costMicros).toBe(9999);
    expect(wallet.actions.get('ai.sound').costMicros).toBe(2000);
    expect(wallet.actions.get('flows.access')).toBeDefined();
    // Not listed: speech keeps its price.
    expect(wallet.actions.get('ai.speech').costMicros).toBe(157500);
    expect(wallet.setActionCost).not.toHaveBeenCalled();
  });

  it('applies a listed revision once', async () => {
    process.env = { ...OLD_ENV, WALLET_PRICE_REVISIONS: 'speech-2026-11' };
    const wallet = repo();
    const service = new WalletPriceRowsService(wallet as any);
    await service.sync();
    expect(wallet.actions.get('ai.speech').costMicros).toBe(84000);
    expect(wallet.actions.get('ai.speech.clone').costMicros).toBe(15000);
    expect(wallet.settings.has(priceRevisionKey('speech-2026-11'))).toBe(true);

    // An admin's later edit stays.
    wallet.actions.get('ai.speech').costMicros = 90000;
    await service.sync();
    expect(wallet.actions.get('ai.speech').costMicros).toBe(90000);
  });

  it('never throws, so the app still boots', async () => {
    const wallet = repo();
    wallet.createActionIfMissing.mockRejectedValue(new Error('db down'));
    await expect(
      new WalletPriceRowsService(wallet as any).sync()
    ).resolves.toBeUndefined();
  });
});
