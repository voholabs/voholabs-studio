jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';
import { BRIEF_ONBOARDING_DOCUMENTS } from '@gitroom/nestjs-libraries/agent-brief/brief.registry';

// BriefService with stub repositories. A plain delete wipes the document's
// revisions, as before; keepHistory keeps them and records the removal.

const ORG = 'org-1';

const build = (stored: any = { content: JSON.stringify({ blocks: [] }) }) => {
  const repository = {
    getDocument: jest.fn(async () => stored),
    saveDocument: jest.fn(async () => ({ updatedAt: new Date() })),
    deleteDocument: jest.fn(async () => ({ count: 1 })),
  };
  const revisions = {
    capture: jest.fn(async () => undefined),
    deleteDocument: jest.fn(async () => ({ count: 3 })),
  };
  const service = new BriefService(
    repository as any,
    {} as any,
    revisions as any
  );
  return { service, repository, revisions };
};

describe('BriefService.deleteDocument', () => {
  it('wipes the history of a deleted source by default', async () => {
    const { service, repository, revisions } = build();
    await expect(
      service.deleteDocument(ORG, 'sources', 'old-site')
    ).resolves.toEqual({ deleted: true });
    expect(repository.getDocument).not.toHaveBeenCalled();
    expect(repository.deleteDocument).toHaveBeenCalledWith(
      ORG,
      'sources',
      'old-site'
    );
    expect(revisions.deleteDocument).toHaveBeenCalledWith(
      ORG,
      'sources',
      'old-site'
    );
    expect(revisions.capture).not.toHaveBeenCalled();
  });

  it('reports a delete of a missing document as deleted by default', async () => {
    const { service, revisions } = build(null);
    await expect(
      service.deleteDocument(ORG, 'sources', 'missing')
    ).resolves.toEqual({ deleted: true });
    expect(revisions.capture).not.toHaveBeenCalled();
  });

  it('says nothing was deleted when asked to report a missing document', async () => {
    const { service, repository, revisions } = build(null);
    await expect(
      service.deleteDocument(ORG, 'sources', 'missing', false, false, true)
    ).resolves.toEqual({ deleted: false });
    expect(repository.deleteDocument).not.toHaveBeenCalled();
    expect(revisions.capture).not.toHaveBeenCalled();
    expect(revisions.deleteDocument).not.toHaveBeenCalled();
  });

  it('keeps only the name of a deleted source in its record', async () => {
    const { service, revisions } = build({
      content: JSON.stringify({ blocks: [{ heading: 'a' }], title: 'Forum' }),
    });
    await service.deleteDocument(ORG, 'sources', 'forum', false, true);
    expect(revisions.capture).toHaveBeenCalledWith(
      ORG,
      'sources',
      'forum',
      { v: 1, blocks: [], title: 'Forum' },
      { deleted: true }
    );
  });

  it('keeps the history and records the removal with keepHistory', async () => {
    const { service, repository, revisions } = build();
    await expect(
      service.deleteDocument(ORG, 'sources', 'old-site', false, true)
    ).resolves.toEqual({ deleted: true });
    expect(repository.deleteDocument).toHaveBeenCalledWith(
      ORG,
      'sources',
      'old-site'
    );
    expect(revisions.deleteDocument).not.toHaveBeenCalled();
    expect(revisions.capture).toHaveBeenCalledWith(
      ORG,
      'sources',
      'old-site',
      { v: 1, blocks: [] },
      { deleted: true }
    );
  });

  it('still refuses a Foundation document, history or not', async () => {
    const { service, repository } = build();
    await expect(
      service.deleteDocument(ORG, 'foundation', 'voice', false, true)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.deleteDocument).not.toHaveBeenCalled();
  });
});

describe('BriefService.saveDocument', () => {
  it('names the allowed keys for an unknown Foundation key', async () => {
    const { service, repository } = build();
    const error = await service
      .saveDocument(ORG, 'foundation', 'brand-voice', { blocks: [] } as any)
      .catch((err) => err);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toContain(
      '"brand-voice" is not a Foundation document'
    );
    expect(error.message).toContain('voice');
    expect(error.message).toContain('additional-info');
    expect(repository.saveDocument).not.toHaveBeenCalled();
  });

  it('lists the categories for an unknown one', async () => {
    const { service } = build();
    await expect(
      service.saveDocument(ORG, 'nope', 'x', { blocks: [] } as any)
    ).rejects.toThrow(/Unknown category "nope". Use one of: foundation/);
  });

  it('keeps the files on a document when only the rules are saved', async () => {
    const assets = [{ id: 'a1', name: 'Logo', url: '/logo.png' }];
    const { service, repository } = build({
      content: JSON.stringify({ blocks: [], assets }),
    });
    const saved = await service.saveDocument(
      ORG,
      'foundation',
      'branding-assets',
      { blocks: [{ id: 'b', heading: 'Use', body: 'Always' }] } as any
    );
    expect(saved.content.assets).toEqual(assets);
    expect(repository.saveDocument).toHaveBeenCalled();
  });
});

describe('BriefService.removeAssets', () => {
  it('removes listed files, keeps the rest and reports unknown ids', async () => {
    const { service, repository, revisions } = build({
      content: JSON.stringify({
        blocks: [{ id: 'b', heading: 'h', body: 'x' }],
        assets: [
          { id: 'a1', name: 'Logo', url: '/logo.png' },
          { id: 'a2', name: 'Shot', url: '/shot.png' },
        ],
      }),
    });
    await expect(service.removeAssets(ORG, ['a1', 'zz'])).resolves.toEqual({
      removed: ['a1'],
      notFound: ['zz'],
      assets: 1,
    });
    const written = JSON.parse(
      (repository.saveDocument.mock.calls[0] as any[])[3]
    );
    expect(written.assets.map((one: any) => one.id)).toEqual(['a2']);
    expect(written.blocks).toHaveLength(1);
    expect(revisions.capture).toHaveBeenCalled();
  });

  it('writes nothing when no id matches', async () => {
    const { service, repository } = build({
      content: JSON.stringify({ blocks: [], assets: [] }),
    });
    await expect(service.removeAssets(ORG, ['zz'])).resolves.toEqual({
      removed: [],
      notFound: ['zz'],
      assets: 0,
    });
    expect(repository.saveDocument).not.toHaveBeenCalled();
  });
});

describe('BriefService.onboardingStatus', () => {
  const row = (key: string, body: string) => ({
    category: 'foundation',
    key,
    content: JSON.stringify({ blocks: [{ id: 'b', heading: '', body }] }),
  });
  const statusOf = (rows: any[]) =>
    new BriefService(
      { getDocuments: jest.fn(async () => rows) } as any,
      { getIntegrationsList: jest.fn(async () => []) } as any,
      {} as any
    ).onboardingStatus(ORG);

  it('is not done while a Foundation document is missing or empty', async () => {
    const status = await statusOf([
      row('north-star', '<p>Be the default</p>'),
      row('business-basics', '<p>We sell X</p>'),
      row('icp', '<p></p>'),
    ]);
    expect(status.done).toBe(false);
    const byKey = Object.fromEntries(
      status.documents.map((d) => [d.key, d.filled])
    );
    expect(byKey['north-star']).toBe(true);
    expect(byKey['business-basics']).toBe(true);
    expect(byKey.icp).toBe(false);
    expect(byKey['branding-assets']).toBe(false);
    // Tasks is no longer part of the brief.
    expect(byKey.tasks).toBeUndefined();
  });

  it('is done once every Foundation document is filled in', async () => {
    const status = await statusOf(
      BRIEF_ONBOARDING_DOCUMENTS.map((key) => row(key, '<p>Something real</p>'))
    );
    expect(status.documents).toHaveLength(BRIEF_ONBOARDING_DOCUMENTS.length);
    expect(status.done).toBe(true);
  });
});

describe('BriefService.onboardingStatus channels', () => {
  it('lists each connected channel as "Platform preferences (account)"', async () => {
    const service = new BriefService(
      { getDocuments: jest.fn(async () => []) } as any,
      {
        getIntegrationsList: jest.fn(async () => [
          {
            id: 'int-1',
            providerIdentifier: 'instagram',
            name: 'VOHOLABS',
            profile: 'voholabs',
            disabled: false,
            inBetweenSteps: false,
          },
          {
            id: 'int-2',
            providerIdentifier: 'x',
            name: 'Paused',
            profile: 'paused',
            disabled: true,
            inBetweenSteps: false,
          },
        ]),
      } as any,
      {} as any,
      {
        getSocialIntegration: jest.fn(() => ({
          name: 'Instagram\n(Facebook Business)',
        })),
      } as any
    );
    const status = await service.onboardingStatus('org-1');
    const channels = status.documents.filter((d) => d.category === 'channels');
    expect(channels).toEqual([
      expect.objectContaining({
        key: 'int-1',
        label: 'Instagram preferences (voholabs)',
        filled: false,
      }),
    ]);
    expect(status.done).toBe(false);
  });
});

describe('BriefService.missingHeadings', () => {
  const stored = {
    content: JSON.stringify({
      blocks: [
        { id: 'a', heading: 'Tone', body: 'Warm' },
        { id: 'b', heading: ' Off limits ', body: 'Politics' },
        { id: 'c', heading: 'Audience', body: 'Founders' },
      ],
    }),
  };

  it('lists the stored headings the new rules leave out, trimmed and case-insensitively', async () => {
    const { service } = build(stored);
    await expect(
      service.missingHeadings(ORG, 'foundation', 'north-star', [
        'tone ',
        'OFF LIMITS',
      ])
    ).resolves.toEqual(['Audience']);
  });

  it('has nothing missing for a document that was never written', async () => {
    const { service } = build(null);
    await expect(
      service.missingHeadings(ORG, 'sources', 'forum', [])
    ).resolves.toEqual([]);
  });

  it('leaves an unknown document to saveDocument', async () => {
    const { service, repository } = build(stored);
    await expect(
      service.missingHeadings(ORG, 'foundation', 'brand', [])
    ).resolves.toEqual([]);
    expect(repository.getDocument).not.toHaveBeenCalled();
  });
});

describe('BriefService brand kit', () => {
  const KIT = {
    colors: [
      { role: 'primary', hex: '#0E1A2B' },
      { role: 'background', hex: '#FFFFFF' },
    ],
    fonts: [{ role: 'headline', family: 'Playfair Display' }],
    logos: [{ variant: 'light', url: '/uploads/logo.png' }],
    imagery: 'Warm candid photos of real customers',
  };
  const branding = (extra: Record<string, any> = {}) => ({
    content: JSON.stringify({
      v: 1,
      blocks: [{ id: 'b', heading: 'Colours', body: 'Navy and white' }],
      assets: [{ id: 'a1', name: 'Logo', url: '/logo.png' }],
      kit: KIT,
      ...extra,
    }),
  });
  const written = (repository: any) =>
    JSON.parse(repository.saveDocument.mock.calls[0][3]);
  const save = (stored: any, body: any, key = 'branding-assets') => {
    const built = build(stored);
    return {
      ...built,
      result: built.service.saveDocument(ORG, 'foundation', key, body),
    };
  };
  const problemOf = (kit: any, key = 'branding-assets') =>
    save(branding(), { kit }, key).result.catch((err: any) => err);

  it('keeps the kit when only the rules are saved (an agent without "kit")', async () => {
    const { result, repository, revisions } = save(branding(), {
      blocks: [{ id: 'c', heading: 'Type', body: 'Serif headings' }],
    });
    expect((await result).content.kit).toEqual(KIT);
    expect(written(repository).kit).toEqual(KIT);
    expect(revisions.capture.mock.calls[0][3].kit).toEqual(KIT);
  });

  it('keeps the kit when only the files are saved', async () => {
    const { result, repository } = save(branding(), {
      assets: [{ id: 'a2', name: 'Shot', url: '/shot.png' }],
    });
    expect((await result).content.kit).toEqual(KIT);
    expect(written(repository).assets).toEqual([
      { id: 'a2', name: 'Shot', url: '/shot.png' },
    ]);
  });

  it('keeps the kit when the agent adds or removes a file', async () => {
    const added = build(branding());
    await added.service.registerAsset(ORG, { name: 'Shot', url: '/s.png' });
    expect(written(added.repository).kit).toEqual(KIT);

    const removed = build(branding());
    await removed.service.removeAssets(ORG, ['a1']);
    expect(written(removed.repository).kit).toEqual(KIT);
    expect(written(removed.repository).assets).toEqual([]);
  });

  it('returns the kit with the document', async () => {
    const service = new BriefService(
      {
        getDocuments: jest.fn(async () => [
          { category: 'foundation', key: 'branding-assets', ...branding() },
        ]),
      } as any,
      { getIntegrationsList: jest.fn(async () => []) } as any,
      {} as any
    );
    const { documents } = await service.getDocuments(ORG);
    expect(documents[0].content.kit).toEqual(KIT);
  });

  it('replaces each kit field sent and keeps the ones left out', async () => {
    const { result } = save(branding(), {
      kit: { colors: [{ role: 'accent', hex: '#c6f432' }] },
    });
    const { kit, blocks, assets } = (await result).content;
    expect(kit).toEqual({
      ...KIT,
      colors: [{ role: 'accent', hex: '#C6F432' }],
    });
    expect(blocks).toHaveLength(1);
    expect(assets).toHaveLength(1);
  });

  it('stores colours in role order and fonts as Google spells them', async () => {
    const { result } = save(null, {
      kit: {
        colors: [
          { role: 'text', hex: '#111111' },
          { role: 'primary', hex: '#0e1a2b' },
        ],
        fonts: [
          { role: 'body', family: ' inter ' },
          { role: 'headline', family: 'playfair display' },
        ],
      },
    });
    expect((await result).content.kit).toEqual({
      colors: [
        { role: 'primary', hex: '#0E1A2B' },
        { role: 'text', hex: '#111111' },
      ],
      fonts: [
        { role: 'headline', family: 'Playfair Display' },
        { role: 'body', family: 'Inter' },
      ],
    });
  });

  it('clears a field sent empty, and leaves no kit once every field is empty', async () => {
    const partial = await save(branding(), {
      kit: { fonts: [], imagery: '' },
    }).result;
    expect(partial.content.kit).toEqual({
      colors: KIT.colors,
      logos: KIT.logos,
    });

    const cleared = save(branding(), {
      kit: { colors: [], fonts: [], logos: [], imagery: '' },
    });
    expect((await cleared.result).content.kit).toBeUndefined();
    expect('kit' in written(cleared.repository)).toBe(false);
  });

  it('refuses a kit on a document that holds none, naming the one that does', async () => {
    const error = await problemOf(KIT, 'voice');
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(
      'Not saved: "kit" belongs to the branding-assets document (category foundation); this document holds no kit.'
    );
  });

  it.each([
    [
      { colors: [{ role: 'primary', hex: '#12G' }] },
      'Not saved: the colour for "primary" is "#12G" and a hex colour reads as six hex digits, like #0E1A2B.',
    ],
    [
      {
        colors: [
          { role: 'accent', hex: '#000000' },
          { role: 'accent', hex: '#FFFFFF' },
        ],
      },
      'Not saved: "accent" is sent twice; the kit holds one colour per role (primary, secondary, accent, background, text, muted, surface).',
    ],
    [
      { colors: [{ role: 'brand', hex: '#000000' }] },
      'Not saved: a colour role is one of primary, secondary, accent, background, text, muted, surface; "brand" is none of them.',
    ],
    [
      { fonts: [{ role: 'display', family: 'Inter' }] },
      'Not saved: a font role is one of headline, body; "display" is neither.',
    ],
    [
      { fonts: [{ role: 'headline', family: 'Helvetica Neue' }] },
      'Not saved: "Helvetica Neue" is not a Google Fonts family. Pick one from fonts.google.com, for example "Inter" or "Playfair Display".',
    ],
    [
      {
        fonts: [
          { role: 'body', family: 'Inter' },
          { role: 'body', family: 'Lato' },
        ],
      },
      'Not saved: "body" is sent twice; the kit holds one font per role (headline, body).',
    ],
    [
      { logos: [{ variant: 'square', url: '/x.png' }] },
      'Not saved: a logo variant is one of light, dark, icon; "square" is none of them.',
    ],
    [
      { logos: [{ variant: 'dark', url: ' ' }] },
      'Not saved: the "dark" logo needs its file, as a media-library path or a link of up to 2048 characters.',
    ],
    [
      {
        logos: [
          { variant: 'icon', url: '/a.png' },
          { variant: 'icon', url: '/b.png' },
        ],
      },
      'Not saved: "icon" is sent twice; the kit holds one logo per variant (light, dark, icon).',
    ],
    [
      { imagery: 'x'.repeat(301) },
      'Not saved: the imagery line is 301 characters; it holds up to 300.',
    ],
  ])('refuses %j with its reason, saving nothing', async (kit, message) => {
    const { result, repository } = save(branding(), { kit });
    const error = await result.catch((err: any) => err);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(message);
    expect(repository.saveDocument).not.toHaveBeenCalled();
  });

  it('counts a branding document holding only a kit as filled', async () => {
    const service = new BriefService(
      {
        getDocuments: jest.fn(async () => [
          {
            category: 'foundation',
            key: 'branding-assets',
            content: JSON.stringify({
              v: 1,
              blocks: [],
              kit: { imagery: 'Bold' },
            }),
          },
        ]),
      } as any,
      { getIntegrationsList: jest.fn(async () => []) } as any,
      {} as any
    );
    const status = await service.onboardingStatus(ORG);
    expect(
      status.documents.find((one) => one.key === 'branding-assets')?.filled
    ).toBe(true);
  });
});
