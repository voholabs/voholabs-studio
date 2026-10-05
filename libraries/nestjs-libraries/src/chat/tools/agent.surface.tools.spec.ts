// What the MCP tells an agent about the wallet, the brief onboarding and the
// brief, kept in step with what the app now does.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/brief/brief.onboarding.service',
  () => ({
    BRIEF_ONBOARDING_ACTION: 'brief.onboarding',
    BriefOnboardingService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/brief/brief.service',
  () => ({ BriefService: class {} })
);

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PostsEditTool } from '@gitroom/nestjs-libraries/chat/tools/posts.edit.tool';
import { BriefOnboardingStatusTool } from '@gitroom/nestjs-libraries/chat/tools/brief.onboarding.status.tool';
import { BriefDeleteTool } from '@gitroom/nestjs-libraries/chat/tools/brief.delete.tool';

const PAID = {
  id: 'org-1',
  subscription: { subscriptionTier: 'ULTIMATE', cancelAt: null },
};
const FREE = {
  id: 'org-1',
  subscription: { subscriptionTier: 'FREE', cancelAt: '2020-01-01' },
};
const PAYG = { ...FREE, walletUnlocks: ['brief', 'skills'] };

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

beforeAll(() => {
  process.env.FRONTEND_URL = 'https://studio.example.com';
});

describe('tool descriptions', () => {
  const sources = readdirSync(__dirname)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => [file, readFileSync(join(__dirname, file), 'utf8')]);

  it.each(sources)('%s has no wording from before charge-at-schedule', (_, text) => {
    expect(text).not.toMatch(/never when it is scheduled/i);
    expect(text).not.toMatch(/when each post is published/i);
    expect(text).not.toMatch(/100 credits/i);
    expect(text).not.toMatch(/tiktok[^.\n]{0,60}(paid plan|paid only|paid-only)/i);
  });
});

describe('briefOnboardingStatus', () => {
  const make = (status: any, price?: number) => {
    const onboarding = { status: jest.fn(async () => status) };
    const wallet = {
      price: jest.fn(async () =>
        price === undefined ? undefined : { price, action: {} }
      ),
    };
    const tool = new BriefOnboardingStatusTool(
      onboarding as any,
      wallet as any
    ).run() as any;
    return { tool, onboarding, wallet };
  };

  it('refuses a free workspace that has not opened the brief', async () => {
    const { tool, onboarding } = make({});
    const result = await tool.execute({}, context(FREE));
    expect(result.error).toMatch(/first wallet top-up/);
    expect(onboarding.status).not.toHaveBeenCalled();
  });

  it('reports the status, the price of a new run and where to start it', async () => {
    const { tool } = make(
      {
        available: true,
        nextRunCharged: true,
        running: null,
        last: {
          id: 'r1',
          status: 'DONE',
          finishedAt: new Date('2026-10-01T00:00:00Z'),
          error: null,
        },
      },
      500
    );
    const result = await tool.execute({}, context(PAYG));
    expect(result).toEqual({
      available: true,
      running: null,
      last: {
        id: 'r1',
        status: 'DONE',
        finishedAt: '2026-10-01T00:00:00.000Z',
        error: null,
      },
      nextRunCharged: true,
      price: '5.00 credits',
      startUrl: 'https://studio.example.com/brief',
    });
  });

  it('gives no start link when the instance has no onboarding', async () => {
    const { tool, wallet } = make({
      available: false,
      nextRunCharged: false,
      running: null,
      last: null,
    });
    const result = await tool.execute({}, context(PAYG));
    expect(result.startUrl).toBeUndefined();
    expect(wallet.price).not.toHaveBeenCalled();
  });
});

describe('briefDeleteTool', () => {
  it('keeps the history only when asked', async () => {
    const briefService = {
      deleteDocument: jest.fn(async () => ({ deleted: true })),
    };
    const tool = new BriefDeleteTool(briefService as any).run() as any;
    await tool.execute(
      { category: 'experience', key: 'a' },
      context(PAYG)
    );
    await tool.execute(
      { category: 'experience', key: 'a', keepHistory: true },
      context(PAYG)
    );
    expect(briefService.deleteDocument.mock.calls[0][4]).toBe(false);
    expect(briefService.deleteDocument.mock.calls[1][4]).toBe(true);
  });
});

describe('editPostTool wallet cost', () => {
  const queued = {
    id: 'p1',
    group: 'g1',
    state: 'QUEUE',
    publishDate: new Date('2030-01-01T00:00:00Z'),
    content: '<p>old</p>',
    settings: '{}',
    integration: { id: 'i1', providerIdentifier: 'x' },
  };

  const make = (post: any, paid: number[]) => {
    let reads = 0;
    const postsService = {
      getPostsRecursively: jest.fn(async () => [
        { ...post, group: reads++ ? 'g2' : post.group },
      ]),
      validatePosts: jest.fn(async () => [
        { valid: true, errors: true, emptyContent: false, tooLong: false },
      ]),
      createPost: jest.fn(async () => []),
    };
    const walletService = {
      billsProvider: jest.fn(async () => true),
      paidForGroup: jest.fn(async () => paid.shift()),
      postActionKey: jest.fn(async () => 'x.post'),
      price: jest.fn(async () => ({ price: 150, action: {} })),
    };
    const tool = new PostsEditTool(
      postsService as any,
      {} as any,
      walletService as any
    ).run() as any;
    return { tool, walletService };
  };

  it('reports what the edit took from the wallet', async () => {
    const { tool, walletService } = make(queued, [150, 300]);
    const result = await tool.execute(
      { id: 'p1', content: '<p>new https://x.com</p>' },
      context(PAYG)
    );
    expect(result.cost).toBe(1.5);
    expect(walletService.paidForGroup).toHaveBeenNthCalledWith(1, 'org-1', 'g1');
    expect(walletService.paidForGroup).toHaveBeenNthCalledWith(2, 'org-1', 'g2');
  });

  it('says what a draft will cost once scheduled', async () => {
    const { tool } = make({ ...queued, state: 'DRAFT' }, []);
    const result = await tool.execute(
      { id: 'p1', content: '<p>new</p>' },
      context(PAYG)
    );
    expect(result.cost).toBeUndefined();
    expect(result.costWhenScheduled).toBe(1.5);
  });

  it('never reads the wallet on a paid plan', async () => {
    const { tool, walletService } = make(queued, [0, 0]);
    const result = await tool.execute(
      { id: 'p1', content: '<p>new</p>' },
      context(PAID)
    );
    expect(result).not.toHaveProperty('cost');
    expect(walletService.billsProvider).not.toHaveBeenCalled();
    expect(walletService.paidForGroup).not.toHaveBeenCalled();
  });
});
