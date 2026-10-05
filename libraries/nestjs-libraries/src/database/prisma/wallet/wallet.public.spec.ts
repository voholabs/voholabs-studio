// The wallet, skills and brief onboarding over the public API: read-only,
// in credits, and a paid plan is told it does not use credits.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service',
  () => ({
    WalletService: class {},
    receiptUrlOf: (entry: any) => entry?.receipt ?? null,
    notEnoughCreditsMessage: () => 'not enough',
    walletFrozenMessage: () => 'frozen',
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/skills/skills.service',
  () => ({ SkillsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/brief/brief.service',
  () => ({ BriefService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/brief/brief.onboarding.service',
  () => ({ BriefOnboardingService: class {} })
);

import { WalletPublicService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.public.service';
import { PublicWalletController } from '@gitroom/backend/public-api/routes/v1/public.wallet.controller';
import { PublicSkillsController } from '@gitroom/backend/public-api/routes/v1/public.skills.controller';
import { PublicBriefController } from '@gitroom/backend/public-api/routes/v1/public.brief.controller';

const PAID = {
  id: 'org-1',
  subscription: { subscriptionTier: 'ULTIMATE', cancelAt: null },
};
const FREE = {
  id: 'org-1',
  subscription: { subscriptionTier: 'FREE', cancelAt: '2020-01-01' },
};

const wallet = () => ({
  getWallet: jest.fn(async () => ({
    autoTopUp: true,
    autoTopUpThreshold: 500,
    autoTopUpAmount: 1000,
    autoTopUpMonthlyCap: null,
    currency: 'USD',
    frozenAt: null,
  })),
  balance: jest.fn(async () => 1234),
  isPayAsYouGo: jest.fn(async () => true),
  forecast: jest.fn(async () => ({ windowHours: 48, needed: 450, short: false })),
  autoTopUpSpentSince: jest.fn(async () => 0),
  currency: jest.fn(async () => 'USD'),
  topUpRules: jest.fn(async () => ({ creditsPerUnit: 20 })),
  priceSections: jest.fn(async () => [
    {
      key: 'channels',
      actions: [
        {
          key: 'x.post',
          name: 'X post',
          description: null,
          provider: 'x',
          unit: 'post',
          billing: 'PER_USE',
          requiresTopUp: true,
          freeUnits: 0,
          freePeriod: null,
          price: 225,
        },
      ],
    },
  ]),
  entries: jest.fn(async () => [
    [
      {
        id: 'e1',
        type: 'SPEND',
        description: 'X post',
        amount: -225,
        quantity: 1,
        actionKey: 'x.post',
        reference: 'p1',
        receipt: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    ],
    25,
  ]),
  estimateContents: jest.fn(async () => ({
    items: [{ actionKey: 'x.post', price: 225 }],
    price: 225,
    alreadyPaid: 0,
    due: 225,
    balanceAfter: 1009,
    short: false,
    autoCovers: false,
    autoAmount: null,
    perOccurrence: false,
  })),
});

beforeAll(() => {
  process.env.FRONTEND_URL = 'https://studio.example.com';
});

describe('WalletPublicService', () => {
  it('tells a paid plan it does not use credits, without reading the wallet', async () => {
    const w = wallet();
    const service = new WalletPublicService(w as any);
    expect(await service.summary(PAID)).toEqual({
      usesWallet: false,
      message: 'Your plan does not use wallet credits.',
    });
    expect((await service.transactions(PAID)).items).toEqual([]);
    expect(await service.estimate(PAID, { provider: 'x', contents: ['a'] })).toMatchObject({ usesWallet: false });
    expect(w.balance).not.toHaveBeenCalled();
    expect(w.entries).not.toHaveBeenCalled();
    expect(w.estimateContents).not.toHaveBeenCalled();
  });

  it('reports the balance in credits, with the rate and the forecast', async () => {
    const service = new WalletPublicService(wallet() as any);
    expect(await service.summary(FREE)).toMatchObject({
      usesWallet: true,
      balance: 12.34,
      payAsYouGo: true,
      frozen: false,
      currency: 'USD',
      creditsPerUnit: 20,
      autoTopUp: { enabled: true, belowCredits: 5, amount: 1000 },
      forecast: { windowHours: 48, neededCredits: 4.5, short: false },
      topUpUrl: 'https://studio.example.com/wallet',
    });
  });

  it('lists prices in credits', async () => {
    const service = new WalletPublicService(wallet() as any);
    const { sections } = await service.prices('X');
    expect(sections[0]).toMatchObject({
      key: 'channels',
      label: 'Channels',
      items: [{ key: 'x.post', credits: 2.25, price: '2.25 credits' }],
    });
  });

  it('pages transactions, signed in credits, and clamps the page size', async () => {
    const w = wallet();
    const service = new WalletPublicService(w as any);
    const page = await service.transactions(FREE, 0, 500, 'spend,nope');
    expect(w.entries).toHaveBeenCalledWith('org-1', 0, 100, ['SPEND']);
    expect(page).toMatchObject({
      total: 25,
      nextPage: null,
      items: [{ id: 'e1', credits: -2.25, createdAt: '2026-10-01T00:00:00.000Z' }],
    });
    const second = await service.transactions(FREE, 0, 10);
    expect(second.nextPage).toBe(1);
  });

  it('prices a post without charging it', async () => {
    const service = new WalletPublicService(wallet() as any);
    expect(
      await service.estimate(FREE, { provider: 'x', contents: ['a'] })
    ).toMatchObject({ charged: true, dueCredits: 2.25, short: false });
  });
});

describe('PublicWalletController', () => {
  it('passes the organization and query through', async () => {
    const service = {
      summary: jest.fn(async () => 'summary'),
      prices: jest.fn(async () => 'prices'),
      transactions: jest.fn(async () => 'page'),
      estimate: jest.fn(async () => 'estimate'),
    };
    const controller = new PublicWalletController(service as any);
    expect(await controller.summary(FREE as any)).toBe('summary');
    expect(await controller.prices('x')).toBe('prices');
    await controller.transactions(FREE as any, '2', '5', 'TOPUP');
    expect(service.transactions).toHaveBeenCalledWith(FREE, 2, 5, 'TOPUP');
    await controller.transactions(FREE as any);
    expect(service.transactions).toHaveBeenLastCalledWith(FREE, 0, 20, undefined);
  });
});

describe('PublicSkillsController', () => {
  it('lists, gets and answers 404 for an unknown skill', async () => {
    const skills = {
      list: jest.fn(async () => ({ tags: [], skills: [] })),
      get: jest.fn(async (slug: string) => (slug === 'hooks' ? { slug } : null)),
    };
    const controller = new PublicSkillsController(skills as any);
    await controller.list('writing', undefined);
    expect(skills.list).toHaveBeenCalledWith({ tag: 'writing', search: undefined });
    expect(await controller.get('hooks')).toEqual({ slug: 'hooks' });
    await expect(controller.get('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('PublicBriefController onboarding', () => {
  it('reports the status and where to start it', async () => {
    const onboarding = {
      status: jest.fn(async () => ({
        available: true,
        nextRunCharged: false,
        running: null,
        last: null,
      })),
    };
    const controller = new PublicBriefController({} as any, onboarding as any);
    expect(await controller.onboardingStatus(FREE as any)).toEqual({
      available: true,
      nextRunCharged: false,
      running: null,
      last: null,
      startUrl: 'https://studio.example.com/brief',
    });
  });

  it('gives no start link when it is not available', async () => {
    const onboarding = {
      status: jest.fn(async () => ({ available: false })),
    };
    const controller = new PublicBriefController({} as any, onboarding as any);
    expect((await controller.onboardingStatus(FREE as any)).startUrl).toBeNull();
  });
});
