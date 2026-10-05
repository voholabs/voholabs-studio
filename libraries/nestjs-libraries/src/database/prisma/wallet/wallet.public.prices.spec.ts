// The public price list: the price rows and top-up rules, read once a minute.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service',
  () => ({ WalletService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

import {
  PUBLIC_PRICES_TTL_MS,
  WalletPublicPricesService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.public.prices.service';

const SECTIONS = [
  {
    key: 'channels',
    actions: [{ key: 'x.post', provider: 'x', price: 225, billing: 'PER_USE' }],
  },
];

const build = (overrides: Record<string, any> = {}) => {
  const wallet = {
    priceSections: jest.fn(async () => SECTIONS),
    topUpRules: jest.fn(async () => ({
      minAmount: 500,
      options: [500, 1000],
      creditsPerUnit: 100,
      autoOptions: [1000],
      capOptions: [5000],
      defaultThreshold: 100,
    })),
    currency: jest.fn(async () => 'USD'),
    ...overrides,
  };
  const integrations = {
    socialProviders: jest.fn(() => [
      { identifier: 'x', name: 'X' },
      { identifier: 'tiktok', name: 'TikTok' },
    ]),
  };
  return {
    wallet,
    service: new WalletPublicPricesService(wallet as any, integrations as any),
  };
};

describe('WalletPublicPricesService', () => {
  afterEach(() => jest.useRealTimers());

  it('returns the price rows, the rate and the top-up choices only', async () => {
    const { service } = build();
    expect(await service.prices()).toEqual({
      currency: 'USD',
      creditsPerUnit: 100,
      topUp: { minAmount: 500, options: [500, 1000] },
      sections: SECTIONS,
      channels: [
        { identifier: 'x', name: 'X' },
        { identifier: 'tiktok', name: 'TikTok' },
      ],
    });
  });

  it('reads the database once a minute', async () => {
    jest.useFakeTimers();
    const { service, wallet } = build();
    await service.prices();
    await service.prices();
    expect(wallet.priceSections).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(PUBLIC_PRICES_TTL_MS + 1);
    await service.prices();
    expect(wallet.priceSections).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read', async () => {
    const priceSections = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(SECTIONS);
    const { service } = build({ priceSections });
    await expect(service.prices()).rejects.toThrow('db down');
    await expect(service.prices()).resolves.toMatchObject({
      sections: SECTIONS,
    });
  });

  it('still lists prices when the top-up settings are missing', async () => {
    const { service } = build({
      topUpRules: jest.fn(async () => {
        throw new Error('not configured');
      }),
      currency: jest.fn(async () => {
        throw new Error('not configured');
      }),
    });
    expect(await service.prices()).toMatchObject({
      currency: null,
      creditsPerUnit: null,
      topUp: null,
      sections: SECTIONS,
    });
  });
});
