jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);

import { BriefListTool } from '@gitroom/nestjs-libraries/chat/tools/brief.list.tool';
import { BriefDeleteTool } from '@gitroom/nestjs-libraries/chat/tools/brief.delete.tool';
import { BriefAssetTool } from '@gitroom/nestjs-libraries/chat/tools/brief.asset.tool';
import { BriefSaveTool } from '@gitroom/nestjs-libraries/chat/tools/brief.save.tool';
import { BriefHistoryTool } from '@gitroom/nestjs-libraries/chat/tools/brief.history.tool';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';

// The brief tools over a stub BriefService, as a paid organization.

const WALLET = {
  id: 'org-1',
  walletUnlocks: ['brief'],
  subscription: { subscriptionTier: 'FREE', cancelAt: '2020-01-01' },
};
const PAID = {
  id: 'org-1',
  subscription: { subscriptionTier: 'ULTIMATE', cancelAt: null },
};

const context = (org: any = WALLET) => {
  const store = new Map<string, string>();
  return {
    mcp: { extra: { authInfo: org } },
    requestContext: {
      set: (key: string, value: string) => store.set(key, value),
      get: (key: string) => store.get(key),
    },
  };
};

const documents = [
  { category: 'foundation', key: 'voice', content: { v: 1, blocks: [] } },
  { category: 'foundation', key: 'icp', content: { v: 1, blocks: [] } },
  { category: 'sources', key: 'forum', content: { v: 1, blocks: [] } },
];

describe('briefListTool', () => {
  const service = { getDocuments: jest.fn(async () => ({ documents })) };
  const tool = new BriefListTool(service as any).run() as any;

  it('returns the schema and every document by default', async () => {
    const result = await tool.execute({}, context());
    expect(result.schema.length).toBeGreaterThan(0);
    expect(result.documents).toHaveLength(3);
  });

  it('returns only the asked-for documents, and names the unwritten ones', async () => {
    const result = await tool.execute(
      { key: 'voice', keys: ['forum', 'tasks'] },
      context()
    );
    expect(result.schema).toBeUndefined();
    expect(result.documents.map((one: any) => one.key)).toEqual([
      'voice',
      'forum',
    ]);
    expect(result.notWritten).toEqual(['tasks']);
  });

  it('describes the brand kit on Branding & assets', () => {
    expect(tool.description).toContain('structured brand kit under "kit"');
  });

  it('refuses an unknown category instead of returning everything', async () => {
    const result = await tool.execute({ category: 'sauces' }, context());
    expect(result.documents).toBeUndefined();
    expect(result.error).toMatch(/Unknown category "sauces"/);
    expect(result.error).toContain('foundation');
  });
});

describe('briefDeleteTool', () => {
  it('says a missing document did not exist without a paid plan', async () => {
    const service = {
      deleteDocument: jest.fn(async () => ({ deleted: false })),
    };
    const tool = new BriefDeleteTool(service as any).run() as any;
    const result = await tool.execute(
      { category: 'sources', key: 'nope' },
      context()
    );
    expect(service.deleteDocument).toHaveBeenCalledWith(
      'org-1',
      'sources',
      'nope',
      true,
      false,
      true
    );
    expect(result.deleted).toBe(false);
    expect(result.error).toMatch(/no "nope" document/);
  });

  it('answers a paid plan as before, without checking the document exists', async () => {
    const service = {
      deleteDocument: jest.fn(async () => ({ deleted: true })),
    };
    const tool = new BriefDeleteTool(service as any).run() as any;
    await expect(
      tool.execute({ category: 'sources', key: 'nope' }, context(PAID))
    ).resolves.toEqual({ deleted: true });
    expect(service.deleteDocument).toHaveBeenCalledWith(
      'org-1',
      'sources',
      'nope',
      true,
      false,
      false
    );
  });

  it('reports a real delete', async () => {
    const service = {
      deleteDocument: jest.fn(async () => ({ deleted: true })),
    };
    const tool = new BriefDeleteTool(service as any).run() as any;
    await expect(
      tool.execute({ category: 'sources', key: 'forum' }, context())
    ).resolves.toEqual({ deleted: true });
  });
});

describe('briefSaveTool', () => {
  it('passes on the allowed keys for an unknown Foundation key', async () => {
    const service = new BriefService(
      { getDocument: jest.fn(), saveDocument: jest.fn() } as any,
      {} as any,
      { capture: jest.fn() } as any
    );
    const tool = new BriefSaveTool(service).run() as any;
    const result = await tool.execute(
      { category: 'foundation', key: 'brand', rules: [] },
      context()
    );
    expect(result.error).toMatch(/"brand" is not a Foundation document/);
    expect(result.error).toMatch(/Allowed keys: north-star/);
  });

  const existing = () => {
    const saveDocument = jest.fn(async () => ({ updatedAt: new Date() }));
    const service = new BriefService(
      {
        getDocument: jest.fn(async () => ({
          content: JSON.stringify({
            blocks: [
              { id: 'a', heading: 'Tone', body: 'Warm' },
              { id: 'b', heading: 'Off limits', body: 'Politics' },
            ],
          }),
        })),
        saveDocument,
      } as any,
      {} as any,
      { capture: jest.fn() } as any
    );
    return { tool: new BriefSaveTool(service).run() as any, saveDocument };
  };

  it('keeps existing rules the call leaves out, and names them', async () => {
    const { tool, saveDocument } = existing();
    const result = await tool.execute(
      {
        category: 'foundation',
        key: 'north-star',
        rules: [{ heading: ' tone', body: 'Warmer' }],
      },
      context()
    );
    expect(saveDocument).not.toHaveBeenCalled();
    expect(result.missing).toEqual(['Off limits']);
    expect(result.error).toMatch(/"Off limits"/);
    expect(result.error).toMatch(/replace: true/);
  });

  it('saves when every existing heading is sent again', async () => {
    const { tool, saveDocument } = existing();
    const result = await tool.execute(
      {
        category: 'foundation',
        key: 'north-star',
        rules: [
          { heading: 'TONE', body: 'Warmer' },
          { heading: 'Off limits', body: 'Politics' },
          { heading: 'Audience', body: 'Founders' },
        ],
      },
      context()
    );
    expect(saveDocument).toHaveBeenCalled();
    expect(result).toMatchObject({ saved: true, rules: 3 });
  });

  it('drops the rules left out when replace is true', async () => {
    const { tool, saveDocument } = existing();
    const result = await tool.execute(
      {
        category: 'foundation',
        key: 'north-star',
        rules: [{ heading: 'Tone', body: 'Warmer' }],
        replace: true,
      },
      context()
    );
    expect(saveDocument).toHaveBeenCalled();
    expect(result).toMatchObject({ saved: true, rules: 1 });
  });

  const branding = () => {
    const kit = { colors: [{ role: 'primary', hex: '#0E1A2B' }] };
    const saveDocument = jest.fn(async () => ({ updatedAt: new Date() }));
    const service = new BriefService(
      {
        getDocument: jest.fn(async () => ({
          content: JSON.stringify({
            blocks: [{ id: 'a', heading: 'Colours', body: 'Navy' }],
            kit,
          }),
        })),
        saveDocument,
      } as any,
      {} as any,
      { capture: jest.fn() } as any
    );
    const written = () => JSON.parse((saveDocument.mock.calls[0] as any[])[3]);
    return {
      tool: new BriefSaveTool(service).run() as any,
      saveDocument,
      written,
      kit,
    };
  };

  it('keeps the kit on a rules-only save from an agent without "kit"', async () => {
    const { tool, written, kit } = branding();
    const result = await tool.execute(
      {
        category: 'foundation',
        key: 'branding-assets',
        rules: [{ heading: 'Colours', body: 'Navy and lime' }],
      },
      context()
    );
    expect(result).toMatchObject({ saved: true, rules: 1, kit });
    expect(written().kit).toEqual(kit);
  });

  it('saves a kit without rules, keeping the rules and skipping the missing check', async () => {
    const { tool, written } = branding();
    const result = await tool.execute(
      {
        category: 'foundation',
        key: 'branding-assets',
        kit: { fonts: [{ role: 'headline', family: 'fraunces' }] },
      },
      context()
    );
    expect(result.missing).toBeUndefined();
    expect(result).toMatchObject({ saved: true, rules: 1 });
    expect(result.kit.fonts).toEqual([
      { role: 'headline', family: 'Fraunces' },
    ]);
    expect(written().blocks).toEqual([
      { id: 'a', heading: 'Colours', body: 'Navy' },
    ]);
    expect(written().kit.colors).toEqual([{ role: 'primary', hex: '#0E1A2B' }]);
  });

  it('returns a kit problem in "error" and saves nothing', async () => {
    const { tool, saveDocument } = branding();
    const result = await tool.execute(
      {
        category: 'foundation',
        key: 'branding-assets',
        kit: { fonts: [{ role: 'body', family: 'Comic Sans MS' }] },
      },
      context()
    );
    expect(result.error).toBe(
      'Not saved: "Comic Sans MS" is not a Google Fonts family. Pick one from fonts.google.com, for example "Inter" or "Playfair Display".'
    );
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('refuses a kit on another document', async () => {
    const { tool, saveDocument } = branding();
    const result = await tool.execute(
      { category: 'foundation', key: 'voice', kit: { imagery: 'Bold' } },
      context()
    );
    expect(result.error).toMatch(
      /"kit" belongs to the branding-assets document/
    );
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('says so when a call carries nothing to write', async () => {
    const { tool, saveDocument } = branding();
    const result = await tool.execute(
      { category: 'foundation', key: 'branding-assets' },
      context()
    );
    expect(result.error).toMatch(/no rules, links, kit or title/);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('documents the remove action on briefAssetTool', () => {
    const tool = new BriefAssetTool({} as any).run() as any;
    expect(tool.inputSchema.shape.action.description).toMatch(/remove/);
  });
});

describe('briefAssetTool', () => {
  const service = {
    registerAsset: jest.fn(async () => ({ assets: 2 })),
    removeAssets: jest.fn(async () => ({
      removed: ['a1'],
      notFound: ['zz'],
      assets: 1,
    })),
  };
  const tool = new BriefAssetTool(service as any).run() as any;

  it('removes files by id', async () => {
    const result = await tool.execute(
      { action: 'remove', assetIds: ['a1', 'zz'] },
      context()
    );
    expect(service.removeAssets).toHaveBeenCalledWith('org-1', ['a1', 'zz']);
    expect(result).toEqual({ removed: ['a1'], notFound: ['zz'], assets: 1 });
  });

  it('asks for ids when removing without any', async () => {
    const result = await tool.execute({ action: 'remove' }, context());
    expect(result.error).toMatch(/assetIds/);
  });

  it('still adds by default, and asks for what adding needs', async () => {
    await expect(
      tool.execute(
        { name: 'Logo', url: '/logo.png', note: 'Dark backgrounds' },
        context()
      )
    ).resolves.toEqual({ registered: true, assets: 2 });
    const missing = await tool.execute({ name: 'Logo' }, context());
    expect(missing.error).toMatch(/"name", "url" and "note"/);
  });
});

describe('briefHistory', () => {
  it('returns the kind of change and points at markLearned', async () => {
    const revisions = {
      getLearningQueue: jest.fn(async () => [
        {
          id: 'sources/forum',
          category: 'sources',
          key: 'forum',
          editedAt: new Date(0),
          learned: false,
          revisionId: 'r',
          change: 'deleted',
          diff: {
            blocksAdded: [],
            blocksRemoved: [],
            blocksEdited: [],
            changed: [],
          },
        },
      ]),
    };
    const tool = new BriefHistoryTool(revisions as any).run() as any;
    const result = await tool.execute({}, context());
    expect(result.documents[0].change).toBe('deleted');
    expect(tool.description).toContain('markLearned with');
    expect(tool.description).not.toContain('markLearnedTool');
  });
});
