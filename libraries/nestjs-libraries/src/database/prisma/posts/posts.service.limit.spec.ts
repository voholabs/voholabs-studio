// One connected account can have at most MAX_POSTS_PER_CHANNEL_PER_DAY posts
// on a UTC day, whatever the plan and whichever way the post comes in. The
// check runs in createPost, before anything is saved. Plain stubs only.
jest.mock('@gitroom/nestjs-libraries/dtos/posts/create.post.dto', () => ({}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({
  ShortLinkService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@gitroom/nestjs-libraries/track/product.analytics', () => ({
  captureOrgEvent: jest.fn(),
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/post-revisions/post-revision.service',
  () => ({ PostRevisionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert', () => ({
  walletAlert: jest.fn(async () => undefined),
}));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  MAX_POSTS_PER_CHANNEL_PER_DAY,
  postsPerChannelPerDayMessage,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

const PAID = {
  subscription: { subscriptionTier: 'ULTIMATE', cancelAt: null, deletedAt: null },
  wallet: null,
};

const setup = (existing: number) => {
  const repository: any = {
    organizationSubscription: jest.fn(async () => PAID),
    organizationBillingState: jest.fn(async () => PAID),
    countPostsForChannelOnDay: jest.fn(async () => existing),
    createOrUpdatePost: jest.fn(async () => ({
      posts: [{ id: 'p1', group: 'g1', state: 'QUEUE' }],
    })),
    getPostById: jest.fn(async () => ({
      id: 'p1',
      group: 'g1',
      state: 'QUEUE',
      publishDate: new Date(),
      integration: { providerIdentifier: 'threads' },
    })),
  };
  const revisions: any = {
    captureSnapshot: jest.fn(async () => undefined),
  };
  const service = new PostsService(
    repository,
    { getSocialIntegration: jest.fn(() => ({ stripLinks: () => false })) } as any,
    { canUseProvider: jest.fn(async () => true) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    revisions,
    { providerLocked: jest.fn() } as any,
    { assertCanSchedule: jest.fn(), settleGroups: jest.fn() } as any
  );
  (service as any).startWorkflow = jest.fn(async () => undefined);
  return { service, repository };
};

const post = (group: string, date?: string) => ({
  group,
  integration: { id: 'i1' },
  settings: { __type: 'threads' },
  value: [{ content: 'hello', image: [] }],
  ...(date ? { date } : {}),
});

const body = (type: string, posts: any[]): any => ({
  type,
  date: '2026-11-10T10:00:00',
  shortLink: false,
  tags: [],
  posts,
});

describe('PostsService daily cap per channel', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, STRIPE_PUBLISHABLE_KEY: 'pk_test' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('refuses the request with 429 when the channel is already at the cap', async () => {
    const { service, repository } = setup(MAX_POSTS_PER_CHANNEL_PER_DAY);
    await expect(
      service.createPost('org', body('schedule', [post('g1')]), 'MCP' as any)
    ).rejects.toMatchObject({
      status: 429,
      message: postsPerChannelPerDayMessage(),
    });
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('saves the last post that fits', async () => {
    const { service, repository } = setup(MAX_POSTS_PER_CHANNEL_PER_DAY - 1);
    await expect(
      service.createPost('org', body('schedule', [post('g1')]), 'APP' as any)
    ).resolves.toEqual([{ postId: 'p1', integration: 'i1' }]);
    expect(repository.countPostsForChannelOnDay).toHaveBeenCalledWith(
      'org',
      'i1',
      new Date('2026-11-10T00:00:00.000Z'),
      new Date('2026-11-11T00:00:00.000Z'),
      ['g1']
    );
  });

  it('counts what the request itself adds to the same channel and day', async () => {
    const { service, repository } = setup(MAX_POSTS_PER_CHANNEL_PER_DAY - 1);
    await expect(
      service.createPost(
        'org',
        body('schedule', [post('g1'), post('g2', '2026-11-10T12:00:00')]),
        'API' as any
      )
    ).rejects.toMatchObject({ status: 429 });
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('counts each day on its own', async () => {
    const { service, repository } = setup(MAX_POSTS_PER_CHANNEL_PER_DAY - 1);
    await service.createPost(
      'org',
      body('schedule', [post('g1'), post('g2', '2026-11-11T12:00:00')]),
      'API' as any
    );
    expect(repository.countPostsForChannelOnDay).toHaveBeenCalledTimes(2);
    expect(repository.createOrUpdatePost).toHaveBeenCalledTimes(2);
  });

  it('never refuses a draft', async () => {
    const { service, repository } = setup(MAX_POSTS_PER_CHANNEL_PER_DAY + 10);
    await service.createPost('org', body('draft', [post('g1')]), 'APP' as any);
    expect(repository.countPostsForChannelOnDay).not.toHaveBeenCalled();
    expect(repository.createOrUpdatePost).toHaveBeenCalledTimes(1);
  });
});
