// X plugs (auto plug, auto repost, re-posters) for a workspace that pays for
// X from its wallet: each paid call is charged before it is made, against an
// in-memory ledger, with X itself faked.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({ IntegrationRepository: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: async () => undefined,
}));
const mockNotices = new Set<string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: async (key: string, ..._rest: unknown[]) => {
      if (mockNotices.has(key)) {
        return null;
      }
      mockNotices.add(key);
      return 'OK';
    },
  },
}));
const mockX = {
  singleTweet: jest.fn(),
  tweet: jest.fn(),
  retweet: jest.fn(),
  tweetLikedBy: jest.fn(),
  me: jest.fn(),
};
jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({ v2: mockX })),
}));

import { HttpException } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { WalletRepository } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.repository';
import {
  InsufficientCreditsError,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  plugChargeKey,
  plugNotRunMessage,
  plugReadChargeKey,
  postExcerpt,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plugs';

type Row = Record<string, any>;

const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) {
        return cond.in.includes(value);
      }
      if ('startsWith' in cond) {
        return typeof value === 'string' && value.startsWith(cond.startsWith);
      }
      return false;
    }
    return value === cond;
  });

const action = (key: string, costMicros: number, unit = 'post') => ({
  id: key,
  key,
  provider: 'x',
  category: 'channels',
  name: key,
  description: null,
  unit,
  freeUnits: null,
  freePeriod: null,
  billing: 'PER_USE',
  requiresTopUp: true,
  costMicros,
  costCurrency: 'USD',
  multiplierBp: null,
  fixedPrice: null,
  active: true,
});

// x.post 2.25, x.post_link 30.00, x.post_read 0.75 (credits_per_unit 100).
const POST = 225;
const LINK = 3000;
const READ = 75;
const ORG = 'org-1';

const fakeDb = () => {
  const entries: Row[] = [];
  const start = Date.now();
  let clock = 0;
  const byNewest = (a: Row, b: Row) => b.createdAt - a.createdAt;
  const model: Row = {
    walletEntry: {
      create: async ({ data }: { data: Row }) => {
        if (entries.some((e) => e.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error('Unique constraint'), {
            code: 'P2002',
          });
        }
        const row = {
          id: `e${entries.length + 1}`,
          quantity: 1,
          createdAt: new Date(start + 1000 * clock++),
          ...data,
        };
        entries.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: Row }) =>
        entries.find((e) => matches(e, where)) || null,
      findFirst: async ({ where }: { where: Row }) =>
        entries.filter((e) => matches(e, where)).sort(byNewest)[0] || null,
      findMany: async ({ where }: { where: Row }) =>
        entries.filter((e) => matches(e, where)).sort(byNewest),
      count: async ({ where }: { where: Row }) =>
        entries.filter((e) => matches(e, where)).length,
      aggregate: async ({ where }: { where: Row }) => {
        const rows = entries.filter((e) => matches(e, where));
        return {
          _sum: {
            amount: rows.length
              ? rows.reduce((s, e) => s + (e.amount || 0), 0)
              : null,
          },
        };
      },
    },
    wallet: {
      upsert: async ({ create }: { create: Row }) => create,
      findUnique: async () => null,
    },
    billableAction: {
      findMany: async () => [
        action('x.post', 15000),
        action('x.post_link', 200000),
        action('x.post_read', 5000, 'read'),
        ...(mockRows.repost ? [action('x.repost', 15000)] : []),
      ],
    },
    billingSetting: {
      findMany: async () =>
        Object.entries({
          wallet_currency: 'USD',
          credits_per_unit: '100',
          default_multiplier_bp: '15000',
        }).map(([key, value]) => ({ key, value })),
    },
    $queryRaw: async () => [],
  };
  model.$transaction = async (cb: (tx: Row) => any) => cb(model);
  return { entries, model };
};

const xIntegration = {
  id: 'ch-1',
  organizationId: ORG,
  providerIdentifier: 'x',
  internalId: 'x-user-1',
  token: 'token:secret',
  profile: 'me',
};

const plugRow = (func: string, data: Row[]) => ({
  id: `plug-${func}`,
  organizationId: ORG,
  plugFunction: func,
  data: JSON.stringify(data),
  integrationId: xIntegration.id,
  activated: true,
  integration: xIntegration,
});

const AUTO_PLUG = plugRow('autoPlugPost', [
  { name: 'likesAmount', value: '10' },
  { name: 'post', value: 'Check out my course' },
]);
const AUTO_REPOST = plugRow('autoRepostPost', [
  { name: 'likesAmount', value: '10' },
]);

// An x.repost row priced like a post (added on the database, not here).
const mockRows = { repost: false };

const SIX_HOURS = 21600000;
const run = (n = 1) => ({
  postId: 'tweet-1',
  delay: SIX_HOURS * n,
  totalRuns: 3,
  currentRun: undefined as unknown as number,
});

const setup = async (
  options: {
    balance?: number;
    paid?: boolean;
    unlocked?: boolean;
    autoTopUp?: number;
  } = {}
) => {
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
  const notifications = { inAppNotification: jest.fn() } as any;
  const wallet = new WalletService(repository, notifications);
  jest
    .spyOn(wallet, 'unlocksProvider')
    .mockResolvedValue(options.unlocked ?? true);
  jest.spyOn(wallet, 'isFrozen').mockResolvedValue(false);
  let toppedUp = false;
  // WalletBillingService.charge: auto top-up once when short, if set.
  const walletBilling = {
    charge: jest.fn(async (params: any) => {
      try {
        return await wallet.charge(params);
      } catch (err) {
        if (
          err instanceof InsufficientCreditsError &&
          options.autoTopUp &&
          !toppedUp
        ) {
          toppedUp = true;
          await repository.add({
            organizationId: ORG,
            amount: options.autoTopUp,
            type: 'AUTO_TOPUP',
            description: 'Auto top-up',
            idempotencyKey: 'auto:1',
          });
          return wallet.charge(params);
        }
        throw err;
      }
    }),
  };
  const x = new XProvider();
  const service = Object.create(IntegrationService.prototype);
  service._walletService = wallet;
  service._walletBilling = walletBilling;
  service._integrationRepository = {
    getPlug: jest.fn(async (id: string) =>
      [AUTO_PLUG, AUTO_REPOST].find((p) => p.id === id)
    ),
    getIntegrationById: jest.fn(async () => xIntegration),
    postByReleaseId: jest.fn(async () => ({
      id: 'post-1',
      content: '<p>My <b>new</b> launch is live</p>',
    })),
    organizationSubscription: jest.fn(async () =>
      options.paid ? { subscription: { subscriptionTier: 'PRO' } } : null
    ),
  };
  service._integrationManager = {
    getSocialIntegration: () => x,
    getAllPlugs: () => [
      {
        identifier: 'x',
        plugs: Reflect.getMetadata('custom:plug', XProvider.prototype),
      },
    ],
    getInternalPlugs: () => ({
      internalPlugs: Reflect.getMetadata(
        'custom:internal_plug',
        XProvider.prototype
      ),
    }),
  };
  jest
    .spyOn(service, 'organizationHasPaidPlan')
    .mockResolvedValue(!!options.paid);
  if (options.balance) {
    await repository.add({
      organizationId: ORG,
      amount: options.balance,
      type: 'TOPUP',
      description: 'Top-up',
      idempotencyKey: 'topup:1',
    });
  }
  const spends = () => db.entries.filter((e) => e.type === 'SPEND');
  const refunds = () => db.entries.filter((e) => e.type === 'REFUND');
  return {
    service: service as IntegrationService,
    wallet,
    walletBilling,
    notifications,
    spends,
    refunds,
    balance: () => repository.balance(ORG),
  };
};

const likes = (n: number) =>
  mockX.singleTweet.mockResolvedValue({
    data: { id: 'tweet-1', public_metrics: { like_count: n } },
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.repost = false;
  mockNotices.clear();
  mockX.tweet.mockResolvedValue({ data: { id: 'reply-1' } });
  mockX.retweet.mockResolvedValue({ data: { retweeted: true } });
  mockX.tweetLikedBy.mockResolvedValue({ meta: { result_count: 50 } });
  mockX.me.mockResolvedValue({ data: { id: 'x-user-2' } });
  likes(50);
});

describe('X auto plug paid from the wallet', () => {
  it('charges the read and the reply before X is asked, then posts', async () => {
    const { service, spends, balance } = await setup({ balance: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).resolves.toBe(true);

    expect(mockX.singleTweet).toHaveBeenCalledWith('tweet-1', {
      'tweet.fields': ['public_metrics'],
    });
    expect(mockX.tweetLikedBy).not.toHaveBeenCalled();
    expect(mockX.tweet).toHaveBeenCalledWith({
      text: 'Check out my course',
      reply: { in_reply_to_tweet_id: 'tweet-1' },
    });
    expect(spends().map((e) => [e.actionKey, e.chargeKey, e.amount])).toEqual([
      ['x.post_read', plugReadChargeKey('x', ORG, 'tweet-1'), -READ],
      ['x.post', plugChargeKey('x', AUTO_PLUG.id, 'tweet-1', 1, 'post'), -POST],
    ]);
    expect(spends()[1].reference).toBe('post-1');
    expect(await balance()).toBe(1000 - READ - POST);
  });

  it('prices a reply with a link as a post with a link', async () => {
    AUTO_PLUG.data = JSON.stringify([
      { name: 'likesAmount', value: '10' },
      { name: 'post', value: 'Join at example.com today' },
    ]);
    try {
      const { service, spends } = await setup({ balance: 5000 });
      await service.processPlugs({ plugId: AUTO_PLUG.id, ...run() });
      expect(spends().map((e) => [e.actionKey, e.amount])).toEqual([
        ['x.post_read', -READ],
        ['x.post_link', -LINK],
      ]);
    } finally {
      AUTO_PLUG.data = plugRow('autoPlugPost', [
        { name: 'likesAmount', value: '10' },
        { name: 'post', value: 'Check out my course' },
      ]).data;
    }
  });

  it('charges only the read while the post is under the like threshold', async () => {
    likes(3);
    const { service, spends } = await setup({ balance: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).resolves.toBe(false);
    expect(mockX.tweet).not.toHaveBeenCalled();
    expect(spends().map((e) => e.actionKey)).toEqual(['x.post_read']);

    // The next run the same UTC day reads the post again: not charged again.
    await service.processPlugs({ plugId: AUTO_PLUG.id, ...run(2) });
    expect(mockX.singleTweet).toHaveBeenCalledTimes(2);
    expect(spends().map((e) => e.actionKey)).toEqual(['x.post_read']);
  });

  it('fails the plug for the post without credits: no X call, no charge, one notice', async () => {
    const { service, spends, notifications } = await setup();
    // true: the plug is done for this post, its later checks are skipped.
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).resolves.toBe(true);

    expect(mockX.singleTweet).not.toHaveBeenCalled();
    expect(mockX.tweet).not.toHaveBeenCalled();
    expect(spends()).toEqual([]);
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
    expect(notifications.inAppNotification).toHaveBeenCalledWith(
      ORG,
      "X plug didn't run",
      plugNotRunMessage(
        'x',
        'credits',
        'My new launch is live',
        `${process.env.FRONTEND_URL}/wallet`
      ),
      false,
      false,
      'fail'
    );

    // A retry of the same run: still no X call and no second notification.
    await service.processPlugs({ plugId: AUTO_PLUG.id, ...run() });
    await service.processPlugs({ plugId: AUTO_PLUG.id, ...run(2) });
    expect(mockX.singleTweet).not.toHaveBeenCalled();
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('reads but does not reply when only the read is covered, and stops', async () => {
    const { service, spends, notifications } = await setup({ balance: READ });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).resolves.toBe(true);
    expect(mockX.singleTweet).toHaveBeenCalledTimes(1);
    expect(mockX.tweet).not.toHaveBeenCalled();
    expect(spends().map((e) => e.actionKey)).toEqual(['x.post_read']);
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('tops up automatically first when that covers it', async () => {
    const { service, spends } = await setup({ balance: READ, autoTopUp: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).resolves.toBe(true);
    expect(mockX.tweet).toHaveBeenCalledTimes(1);
    expect(spends().map((e) => e.actionKey)).toEqual(['x.post_read', 'x.post']);
  });

  it('refunds the reply when X refuses it', async () => {
    mockX.tweet.mockRejectedValueOnce(new Error('X said no'));
    const { service, refunds, balance } = await setup({ balance: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).rejects.toThrow('X said no');
    expect(refunds().map((e) => [e.actionKey, e.amount])).toEqual([
      ['x.post', POST],
    ]);
    // The read went through and stays paid.
    expect(await balance()).toBe(1000 - READ);
  });

  it('charges a retried run once', async () => {
    const { service, spends, balance } = await setup({ balance: 1000 });
    await service.processPlugs({ plugId: AUTO_PLUG.id, ...run() });
    // Temporal retries the same run (e.g. the activity timed out after X
    // took the reply).
    await service.processPlugs({ plugId: AUTO_PLUG.id, ...run() });
    expect(spends()).toHaveLength(2);
    expect(await balance()).toBe(1000 - READ - POST);

    // A retry whose X call fails does not give back the charge of the
    // attempt that went through.
    mockX.tweet.mockRejectedValueOnce(new Error('duplicate'));
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).rejects.toThrow('duplicate');
    expect(await balance()).toBe(1000 - READ - POST);
  });

  it('charges a refused-then-retried reply again only once', async () => {
    mockX.tweet.mockRejectedValueOnce(new Error('try later'));
    const { service, spends, balance } = await setup({ balance: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).rejects.toThrow('try later');
    await service.processPlugs({ plugId: AUTO_PLUG.id, ...run() });
    expect(spends().map((e) => e.idempotencyKey)).toEqual([
      `${plugReadChargeKey('x', ORG, 'tweet-1')}#1`,
      `${plugChargeKey('x', AUTO_PLUG.id, 'tweet-1', 1, 'post')}#1`,
      `${plugChargeKey('x', AUTO_PLUG.id, 'tweet-1', 1, 'post')}#2`,
    ]);
    expect(await balance()).toBe(1000 - READ - POST);
  });
});

describe('X plugs with no price row', () => {
  it('does not run auto repost at all (reposts have no price)', async () => {
    const { service, spends, notifications } = await setup({ balance: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_REPOST.id, ...run() })
    ).resolves.toBe(true);
    expect(mockX.singleTweet).not.toHaveBeenCalled();
    expect(mockX.retweet).not.toHaveBeenCalled();
    expect(spends()).toEqual([]);
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('does not run re-posters', async () => {
    const { service, spends } = await setup({ balance: 1000 });
    await service.processInternalPlug({
      post: 'tweet-1',
      originalIntegration: 'ch-1',
      integration: 'ch-2',
      plugName: 'x-repost-post-users',
      orgId: ORG,
      delay: 0,
      information: {},
    });
    expect(mockX.me).not.toHaveBeenCalled();
    expect(mockX.retweet).not.toHaveBeenCalled();
    expect(spends()).toEqual([]);
  });

  it('refuses to set it up', async () => {
    const { service } = await setup({ balance: 1000 });
    await expect(
      service.assertCanSetPlug(ORG, 'x', 'autoRepostPost')
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.assertCanSetPlug(ORG, 'x', 'autoPlugPost')
    ).resolves.toBeUndefined();
  });
});

describe('X reposts once an x.repost row exists', () => {
  it('auto repost charges the read and the repost, then reposts', async () => {
    mockRows.repost = true;
    const { service, spends } = await setup({ balance: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_REPOST.id, ...run() })
    ).resolves.toBe(true);
    expect(mockX.retweet).toHaveBeenCalledWith('x-user-1', 'tweet-1');
    expect(spends().map((e) => [e.actionKey, e.chargeKey, e.amount])).toEqual([
      ['x.post_read', plugReadChargeKey('x', ORG, 'tweet-1'), -READ],
      [
        'x.repost',
        plugChargeKey('x', AUTO_REPOST.id, 'tweet-1', 1, 'repost'),
        -POST,
      ],
    ]);
    await expect(
      service.assertCanSetPlug(ORG, 'x', 'autoRepostPost')
    ).resolves.toBeUndefined();
  });

  it('re-posters repost with the stored user id, charged once', async () => {
    mockRows.repost = true;
    const { service, spends } = await setup({ balance: 1000 });
    const data = {
      post: 'tweet-1',
      originalIntegration: 'ch-1',
      integration: 'ch-2',
      plugName: 'x-repost-post-users',
      orgId: ORG,
      delay: 0,
      information: {},
    };
    await service.processInternalPlug(data);
    await service.processInternalPlug(data);
    expect(mockX.me).not.toHaveBeenCalled();
    expect(mockX.retweet).toHaveBeenCalledWith('x-user-1', 'tweet-1');
    expect(spends().map((e) => [e.actionKey, e.amount])).toEqual([
      ['x.repost', -POST],
    ]);
  });

  it('a refused repost is refunded', async () => {
    mockRows.repost = true;
    mockX.retweet.mockRejectedValueOnce(new Error('X said no'));
    const { service, refunds } = await setup({ balance: 1000 });
    await expect(
      service.processPlugs({ plugId: AUTO_REPOST.id, ...run() })
    ).rejects.toThrow('X said no');
    expect(refunds().map((e) => [e.actionKey, e.amount])).toEqual([
      ['x.repost', POST],
    ]);
  });
});

describe('X plugs on a paid plan', () => {
  it('run as before and are never charged', async () => {
    const { service, walletBilling, spends } = await setup({ paid: true });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).resolves.toBe(true);
    expect(mockX.tweetLikedBy).toHaveBeenCalledWith('tweet-1');
    expect(mockX.singleTweet).not.toHaveBeenCalled();
    expect(mockX.tweet).toHaveBeenCalledTimes(1);
    expect(walletBilling.charge).not.toHaveBeenCalled();
    expect(spends()).toEqual([]);

    await service.processPlugs({ plugId: AUTO_REPOST.id, ...run() });
    expect(mockX.retweet).toHaveBeenCalledWith('x-user-1', 'tweet-1');
    await expect(
      service.assertCanSetPlug(ORG, 'x', 'autoRepostPost')
    ).resolves.toBeUndefined();
  });
});

describe('X plugs on the free plan without a top-up', () => {
  it('stay locked: nothing runs, nothing is charged', async () => {
    const { service, walletBilling, notifications } = await setup({
      unlocked: false,
    });
    await expect(
      service.processPlugs({ plugId: AUTO_PLUG.id, ...run() })
    ).resolves.toBe(true);
    expect(mockX.singleTweet).not.toHaveBeenCalled();
    expect(mockX.tweetLikedBy).not.toHaveBeenCalled();
    expect(mockX.tweet).not.toHaveBeenCalled();
    expect(walletBilling.charge).not.toHaveBeenCalled();
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('refuse setup with the wallet top-up', async () => {
    const { service } = await setup({ unlocked: false });
    const err = await service
      .assertCanSetPlug(ORG, 'x', 'autoPlugPost')
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(402);
    expect(err.getResponse()).toMatchObject({ wallet: true, url: '/wallet' });
  });

  it('leave other providers alone', async () => {
    const { service } = await setup({ unlocked: false });
    await expect(
      service.assertCanSetPlug(ORG, 'linkedin-page', 'autoRepostPost')
    ).resolves.toBeUndefined();
  });
});

describe('plug notification text', () => {
  it('escapes and shortens the post', () => {
    expect(postExcerpt('<p>a <script>x</script> b</p>')).toBe('a x b');
    expect(
      plugNotRunMessage('x', 'credits', '<b>"hi"</b>', 'https://app/wallet')
    ).toBe(
      "Your X plug on '&lt;b&gt;&quot;hi&quot;&lt;/b&gt;' didn't run: not enough credits. Top up to keep plugs running: https://app/wallet"
    );
    expect(postExcerpt('x'.repeat(100))).toHaveLength(60);
  });
});
