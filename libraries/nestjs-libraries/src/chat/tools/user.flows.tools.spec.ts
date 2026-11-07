// The four gateway-only flow tools: served to the MCP gateway only, open with
// Plus (or a paid plan), and answering in the shapes the gateway reads.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.service',
  () => ({ UserFlowsService: class {} })
);

import { readFileSync } from 'fs';
import { join } from 'path';
import { FlowsListTool } from '@gitroom/nestjs-libraries/chat/tools/flows.list.tool';
import { FlowGetTool } from '@gitroom/nestjs-libraries/chat/tools/flow.get.tool';
import { FlowSaveTool } from '@gitroom/nestjs-libraries/chat/tools/flow.save.tool';
import { FlowShareTool } from '@gitroom/nestjs-libraries/chat/tools/flow.share.tool';
import { NotFoundException } from '@nestjs/common';

const PAID = {
  id: 'org-1',
  subscription: { subscriptionTier: 'ULTIMATE', cancelAt: null },
};
const FREE = {
  id: 'org-1',
  subscription: { subscriptionTier: 'FREE', cancelAt: '2020-01-01' },
};
// Plus (or pay-as-you-go from before it) opens the "flows" key.
const PLUS = { ...FREE, walletUnlocks: ['brief', 'skills', 'flows'] };
// A top-up that only opened the older keys.
const SKILLS_ONLY = { ...FREE, walletUnlocks: ['brief', 'skills'] };

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

const updatedAt = new Date('2026-11-01T10:00:00Z');
const flows = () => ({
  list: jest.fn(async () => [
    {
      id: 'f1',
      slug: 'recap',
      title: 'Recap',
      whenToUse: 'Fridays',
      summary: 'A weekly recap',
      category: null,
      cost: null,
      foundation: ['business-basics'],
      source: 'SAVED_FROM_CHAT',
      poster: null,
      updatedAt,
      shared: true,
    },
  ]),
  get: jest.fn(async (_org: string, slug: string) =>
    slug === 'recap'
      ? {
          id: 'f1',
          slug: 'recap',
          title: 'Recap',
          whenToUse: '',
          summary: '',
          category: 'writing',
          cost: null,
          foundation: [],
          body: 'The method',
          parts: { hook: 'h' },
          brandSlots: ['palette'],
          source: 'FORKED',
          forkedFromId: 'fact-short',
          poster: null,
          exampleVideo: null,
          version: 2,
          updatedAt,
          shared: false,
          shareUrl: null,
        }
      : null
  ),
  save: jest.fn(async () => ({ slug: 'recap', created: true, warnings: [] })),
  share: jest.fn(async () => ({
    url: 'https://studio.example.com/flows/shared/tok',
    token: 'tok',
  })),
  revoke: jest.fn(async () => ({ revoked: true })),
});

const tools = (service: ReturnType<typeof flows>) => ({
  list: new FlowsListTool(service as any).run() as any,
  get: new FlowGetTool(service as any).run() as any,
  save: new FlowSaveTool(service as any).run() as any,
  share: new FlowShareTool(service as any).run() as any,
});

const OLD_ENV = process.env;
beforeAll(() => {
  // With billing on, a workspace without a subscription is on the free plan.
  process.env = {
    ...OLD_ENV,
    FRONTEND_URL: 'https://studio.example.com',
    STRIPE_SECRET_KEY: 'sk_test',
  };
});
afterAll(() => {
  process.env = OLD_ENV;
});

describe('where the flow tools are served', () => {
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('lists them to the gateway only', () => {
    const gateway = read('gateway.tool.list.ts');
    for (const name of ['FlowsListTool', 'FlowGetTool', 'FlowSaveTool', 'FlowShareTool']) {
      expect(gateway).toContain(`  ${name},`);
      expect(read('tool.list.ts')).not.toContain(name);
      expect(read('mcp.only.tool.list.ts')).not.toContain(name);
    }
  });

  it('has retired the media editing tools', () => {
    expect(read('tool.list.ts')).not.toMatch(/mediaMcp|MediaMcp/);
  });
});

describe('the Plus lock', () => {
  it.each([
    ['list', {}],
    ['get', { slug: 'recap' }],
    ['save', { title: 'T', body: 'b' }],
    ['share', { slug: 'recap', action: 'create' }],
  ])('%s refuses a workspace without Plus, with the upgrade link', async (name, input) => {
    for (const org of [FREE, SKILLS_ONLY]) {
      const service = flows();
      const result = await (tools(service) as any)[name].execute(input, context(org));
      expect(result).toEqual({
        error: 'Flows are included with Plus: https://studio.example.com/plus',
        code: 'plus_required',
        upgradeUrl: 'https://studio.example.com/plus',
      });
      expect(Object.values(service).every((fn) => !fn.mock.calls.length)).toBe(true);
    }
  });

  it('opens with Plus and on a paid plan', async () => {
    for (const org of [PLUS, PAID]) {
      const result = await tools(flows()).list.execute({}, context(org));
      expect(result.flows).toHaveLength(1);
    }
  });
});

describe('flowsList', () => {
  it('returns the fields the gateway reads', async () => {
    const result = await tools(flows()).list.execute({}, context(PLUS));
    expect(result).toEqual({
      flows: [
        {
          slug: 'recap',
          title: 'Recap',
          whenToUse: 'Fridays',
          summary: 'A weekly recap',
          category: null,
          cost: null,
          foundation: ['business-basics'],
          source: 'SAVED_FROM_CHAT',
          poster: null,
          shared: true,
          updatedAt: '2026-11-01T10:00:00.000Z',
        },
      ],
    });
  });
});

describe('flowGet', () => {
  it('returns one flow whole', async () => {
    const result = await tools(flows()).get.execute({ slug: 'recap' }, context(PLUS));
    expect(result).toEqual({
      slug: 'recap',
      title: 'Recap',
      whenToUse: '',
      summary: '',
      category: 'writing',
      cost: null,
      foundation: [],
      body: 'The method',
      parts: { hook: 'h' },
      brandSlots: ['palette'],
      source: 'FORKED',
      forkedFromId: 'fact-short',
    });
  });

  it('says "flow not found" for an unknown slug', async () => {
    const result = await tools(flows()).get.execute({ slug: 'nope' }, context(PLUS));
    expect(result).toEqual({ error: 'flow not found' });
  });
});

describe('flowSave', () => {
  it('saves from a chat, editing a flow that has the slug', async () => {
    const service = flows();
    const result = await tools(service).save.execute(
      { slug: 'recap', title: 'Recap', body: 'b', forkOf: 'fact-short' },
      context(PLUS)
    );
    expect(result).toEqual({ slug: 'recap', created: true, warnings: [] });
    expect(service.save).toHaveBeenCalledWith(
      'org-1',
      { slug: 'recap', title: 'Recap', body: 'b' },
      {
        source: 'SAVED_FROM_CHAT',
        forkOf: 'fact-short',
        importToken: undefined,
        overwrite: true,
      }
    );
  });

  it('imports with a token alone', async () => {
    const service = flows();
    await tools(service).save.execute({ importToken: 'tok' }, context(PLUS));
    expect(service.save.mock.calls[0][2]).toMatchObject({ importToken: 'tok' });
  });

  it('needs a title and a body otherwise', async () => {
    const service = flows();
    const result = await tools(service).save.execute({ title: 'T' }, context(PLUS));
    expect(result.error).toMatch(/title and a body/);
    expect(service.save).not.toHaveBeenCalled();
  });

  it('passes on the reason a save was refused', async () => {
    const service = flows();
    service.save.mockRejectedValueOnce(
      new NotFoundException('This share link was turned off or never existed')
    );
    const result = await tools(service).save.execute({ importToken: 'x' }, context(PLUS));
    expect(result).toEqual({
      error: 'This share link was turned off or never existed',
    });
  });
});

describe('flowShare', () => {
  it('creates and revokes', async () => {
    const service = flows();
    const { share } = tools(service);
    expect(
      await share.execute({ slug: 'recap', action: 'create' }, context(PLUS))
    ).toEqual({
      url: 'https://studio.example.com/flows/shared/tok',
      token: 'tok',
    });
    expect(
      await share.execute({ slug: 'recap', action: 'revoke' }, context(PLUS))
    ).toEqual({ revoked: true });
  });
});
