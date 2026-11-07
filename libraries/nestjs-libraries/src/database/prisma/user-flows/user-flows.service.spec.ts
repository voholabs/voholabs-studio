import { Prisma } from '@prisma/client';
import {
  slugify,
  UserFlowsService,
} from '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.service';
import { scrubFlow, scrubText } from '@gitroom/nestjs-libraries/flows/flows.scrub';

// The skills library: two active skills.
const SKILLS = [
  {
    slug: 'hooks',
    name: 'Hooks',
    summary: 'Openers that stop the scroll',
    whenToUse: 'The first line',
    body: 'Hook steps',
  },
  {
    slug: 'voice',
    name: 'Your voice',
    summary: 'Write like the user',
    whenToUse: null,
    body: 'Voice steps',
  },
];

// The repository's methods over plain arrays: no database.
const memory = () => {
  const flows: any[] = [];
  const library = [...SKILLS];
  const shares: any[] = [];
  let ids = 0;
  const withShares = (flow: any) => ({
    ...flow,
    shares: shares
      .filter((s) => s.userFlowId === flow.id && !s.revokedAt)
      .slice(0, 1)
      .map((s) => ({ token: s.token })),
  });
  const repo = {
    list: jest.fn(async (organizationId: string) =>
      flows
        .filter((f) => f.organizationId === organizationId && !f.deletedAt)
        .map(withShares)
    ),
    get: jest.fn(async (organizationId: string, slug: string) => {
      const flow = flows.find(
        (f) =>
          f.organizationId === organizationId && f.slug === slug && !f.deletedAt
      );
      return flow ? withShares(flow) : null;
    }),
    slugRow: jest.fn(async (organizationId: string, slug: string) => {
      const flow = flows.find(
        (f) => f.organizationId === organizationId && f.slug === slug
      );
      return flow ? { id: flow.id, deletedAt: flow.deletedAt } : null;
    }),
    base: jest.fn(async (organizationId: string, slug: string) => {
      const flow = flows.find(
        (f) =>
          f.organizationId === organizationId && f.slug === slug && !f.deletedAt
      );
      return flow ? { ...flow } : null;
    }),
    dependents: jest.fn(async (organizationId: string, slug: string) =>
      flows
        .filter(
          (f) =>
            f.organizationId === organizationId &&
            !f.deletedAt &&
            f.basedOn === `my/${slug}`
        )
        .map((f) => ({ slug: f.slug, title: f.title }))
    ),
    origin: jest.fn(async (organizationId: string, slug: string) => {
      const flow = flows.find(
        (f) => f.organizationId === organizationId && f.slug === slug
      );
      return flow
        ? { source: flow.source, forkedFromId: flow.forkedFromId }
        : null;
    }),
    slugsLike: jest.fn(async (organizationId: string, slug: string) =>
      flows
        .filter(
          (f) => f.organizationId === organizationId && f.slug.startsWith(slug)
        )
        .map((f) => ({ slug: f.slug }))
    ),
    create: jest.fn(async (organizationId: string, slug: string, data: any) => {
      if (flows.some((f) => f.organizationId === organizationId && f.slug === slug)) {
        throw new Error('unique');
      }
      const flow = {
        id: `f${++ids}`,
        organizationId,
        slug,
        whenToUse: '',
        summary: '',
        category: null,
        cost: null,
        foundation: [],
        body: '',
        parts: null,
        brandSlots: ['palette'],
        poster: null,
        exampleVideo: null,
        basedOn: null,
        customization: '',
        skills: [],
        version: 1,
        deletedAt: null,
        updatedAt: new Date(),
        ...data,
      };
      if (flow.parts === Prisma.DbNull) {
        flow.parts = null;
      }
      flows.push(flow);
      return { id: flow.id, slug };
    }),
    update: jest.fn(async (id: string, data: any) => {
      const flow = flows.find((f) => f.id === id);
      Object.assign(flow, data, { version: flow.version + 1 });
      if (flow.parts === Prisma.DbNull) {
        flow.parts = null;
      }
      return { id, slug: flow.slug };
    }),
    softDelete: jest.fn(async (id: string) => {
      flows.find((f) => f.id === id).deletedAt = new Date();
      return { id };
    }),
    activeShare: jest.fn(async (userFlowId: string) => {
      const share = shares.find((s) => s.userFlowId === userFlowId && !s.revokedAt);
      return share ? { token: share.token } : null;
    }),
    createShare: jest.fn(
      async (organizationId: string, userFlowId: string, token: string) => {
        shares.push({
          id: `s${++ids}`,
          organizationId,
          userFlowId,
          token,
          imports: 0,
          revokedAt: null,
        });
        return { token };
      }
    ),
    revokeShares: jest.fn(async (userFlowId: string) => {
      const live = shares.filter((s) => s.userFlowId === userFlowId && !s.revokedAt);
      live.forEach((s) => (s.revokedAt = new Date()));
      return { count: live.length };
    }),
    shared: jest.fn(async (token: string) => {
      const share = shares.find((s) => s.token === token && !s.revokedAt);
      const flow = share && flows.find((f) => f.id === share.userFlowId);
      return share && flow && !flow.deletedAt
        ? { id: share.id, organizationId: share.organizationId, userFlow: flow }
        : null;
    }),
    countImport: jest.fn(async (shareId: string) => {
      shares.find((s) => s.id === shareId).imports++;
      return { id: shareId };
    }),
  };
  const skills = {
    bySlugs: jest.fn(async (slugs: string[]) =>
      library.filter((skill) => slugs.includes(skill.slug))
    ),
  };
  return {
    repo,
    flows,
    shares,
    library,
    service: new UserFlowsService(repo as any, skills as any),
  };
};

beforeAll(() => {
  process.env.FRONTEND_URL = 'https://studio.example.com/';
});

describe('slugify', () => {
  it('makes a slug from a title', () => {
    expect(slugify('Carousel for Launches!')).toBe('carousel-for-launches');
    expect(slugify('Café crème')).toBe('cafe-creme');
    expect(slugify('!!!')).toBe('flow');
  });
});

describe('scrub', () => {
  it('replaces colour codes, drops media links and our name', () => {
    const { text, found } = scrubText(
      'Use #FF5500 and #fff on Voholabs Studio. Logo: https://pub-1.r2.dev/logo.png. See https://example.com/guide for the method. #launch #bad'
    );
    expect(found).toEqual({ colours: 2, links: 1, names: 1 });
    expect(text).toContain("the brand's accent colour and the brand's accent colour");
    expect(text).not.toMatch(/r2\.dev|voholabs/i);
    expect(text).toContain('https://example.com/guide');
    expect(text).toContain('#launch #bad');
  });

  it('only reports when not applied', () => {
    const flow = { title: 'A', body: 'Accent #123456' };
    const { flow: kept, warnings } = scrubFlow(flow, false);
    expect(kept).toBe(flow);
    expect(warnings).toHaveLength(1);
  });

  it('scrubs the parts too', () => {
    const { flow } = scrubFlow({ body: '', parts: { hook: 'Colour #abcdef' } });
    expect(flow.parts?.hook).toBe("Colour the brand's accent colour");
  });
});

describe('UserFlowsService', () => {
  it('creates a flow with a slug from its title, then a free one next to it', async () => {
    const { service } = memory();
    const first = await service.save('org-1', { title: 'Weekly recap', body: 'Do it' });
    const second = await service.save('org-1', { title: 'Weekly recap', body: 'Again' });
    expect(first).toEqual({ slug: 'weekly-recap', created: true, warnings: [] });
    expect(second.slug).toBe('weekly-recap-2');
  });

  it('updates an existing flow through the MCP save and keeps what is left out', async () => {
    const { service, flows } = memory();
    await service.save('org-1', {
      title: 'Recap',
      body: 'v1',
      summary: 'kept',
      parts: { hook: 'h' },
    });
    const result = await service.save(
      'org-1',
      { slug: 'recap', title: 'Recap', body: 'v2' },
      { overwrite: true, source: 'SAVED_FROM_CHAT' }
    );
    expect(result.created).toBe(false);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({
      body: 'v2',
      summary: 'kept',
      parts: { hook: 'h' },
      version: 2,
      source: 'CREATED',
    });
  });

  it('never overwrites a flow from the app, a fork or an import', async () => {
    const { service, flows } = memory();
    await service.save('org-1', { title: 'Recap', body: 'mine' });
    const again = await service.save('org-1', { slug: 'recap', title: 'Recap', body: 'other' });
    expect(again.slug).toBe('recap-2');
    expect(flows[0].body).toBe('mine');
  });

  it('warns about brand content on a save and saves it as written', async () => {
    const { service, flows } = memory();
    const result = await service.save('org-1', {
      title: 'Brand',
      body: 'Accent #00AAFF',
    });
    expect(result.warnings).toHaveLength(1);
    expect(flows[0].body).toBe('Accent #00AAFF');
  });

  it('forks a library flow and records where it came from', async () => {
    const { service, flows } = memory();
    const result = await service.fork('org-1', {
      id: 'fact-short',
      title: 'Fact short',
      body: 'The method',
      parts: { script: 'Write it' },
      poster: 'https://cdn.example.com/p.jpg',
      category: 'video',
    });
    expect(result).toMatchObject({ slug: 'fact-short', created: true });
    expect(flows[0]).toMatchObject({
      source: 'FORKED',
      forkedFromId: 'fact-short',
      parts: { script: 'Write it' },
      poster: 'https://cdn.example.com/p.jpg',
      category: 'video',
    });
    const again = await service.fork('org-1', {
      id: 'fact-short',
      title: 'Fact short',
      body: 'The method',
    });
    expect(again.slug).toBe('fact-short-2');
  });

  it('shares once, revokes, and a revoked link stops working', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'Recap', body: 'b' });
    const link = await service.share('org-1', 'recap');
    expect(link.url).toBe(`https://studio.example.com/flows/shared/${link.token}`);
    expect((await service.share('org-1', 'recap')).token).toBe(link.token);
    expect((await service.list('org-1'))[0].shared).toBe(true);
    expect(await service.revoke('org-1', 'recap')).toEqual({ revoked: true });
    await expect(service.shared(link.token)).rejects.toThrow(/turned off/);
    expect(await service.revoke('org-1', 'recap')).toEqual({ revoked: false });
  });

  it('never shares a copy of a library flow, nor a copy of that copy', async () => {
    const { service } = memory();
    await service.fork('org-1', { id: 'carousel', title: 'Carousel', body: 'Voho method' });
    await service.save('org-1', { title: 'Carousel v2', body: 'Voho method, edited' }, { forkOf: 'my/carousel' });
    await service.save('org-1', { title: 'Recap', body: 'My own method' });

    await expect(service.share('org-1', 'carousel')).rejects.toThrow(/cannot be shared/);
    await expect(service.share('org-1', 'carousel-v2')).rejects.toThrow(/cannot be shared/);
    expect((await service.share('org-1', 'recap')).token).toBeTruthy();

    const shareable = Object.fromEntries(
      (await service.list('org-1')).map((f: any) => [f.slug, f.shareable])
    );
    expect(shareable).toEqual({ carousel: false, 'carousel-v2': false, recap: true });
    expect((await service.list('org-1'))[0]).not.toHaveProperty('forkedFromId');
  });

  it('opens nothing for a link made to a library copy before the rule', async () => {
    const { service, repo, flows } = memory();
    await service.fork('org-1', { id: 'fact-short', title: 'Fact short', body: 'Voho method' });
    await repo.createShare('org-1', flows[0].id, 'old-token');
    await expect(service.shared('old-token')).rejects.toThrow(/turned off/);
    await expect(service.import('org-2', 'old-token')).rejects.toThrow(/turned off/);
  });

  it('keeps where a flow came from off the shared page', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'Recap', body: 'b' });
    const { token } = await service.share('org-1', 'recap');
    const { flow } = await service.shared(token);
    expect(flow).not.toHaveProperty('source');
    expect(flow).not.toHaveProperty('forkedFromId');
  });

  it('imports a shared flow into another workspace, scrubbed', async () => {
    const { service, flows, shares } = memory();
    await service.save('org-1', {
      title: 'Carousel',
      body: 'Slides in #FF0000 with https://pub-1.r2.dev/logo.png',
      cost: '{{credits image 5}}',
    });
    const { token } = await service.share('org-1', 'carousel');

    const preview = await service.shared(token);
    expect(preview.flow.body).not.toContain('#FF0000');
    expect(preview.warnings).toHaveLength(2);

    const result = await service.save('org-2', {}, { importToken: token });
    expect(result).toMatchObject({ slug: 'carousel', created: true });
    expect(result.warnings).toHaveLength(2);
    const copy = flows.find((f) => f.organizationId === 'org-2');
    expect(copy).toMatchObject({
      source: 'IMPORTED',
      importedShareId: shares[0].id,
      cost: '{{credits image 5}}',
    });
    expect(copy.body).toBe("Slides in the brand's accent colour with");
    expect(shares[0].imports).toBe(1);
    // The author's flow is untouched.
    expect(flows[0].body).toContain('#FF0000');
  });

  it('refuses an unknown share token', async () => {
    const { service } = memory();
    await expect(service.import('org-1', 'nope')).rejects.toThrow(/turned off/);
  });

  it('deletes a flow, turns its link off and keeps its slug taken', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'Recap', body: 'b' });
    const { token } = await service.share('org-1', 'recap');
    await service.delete('org-1', 'recap');
    expect(await service.get('org-1', 'recap')).toBeNull();
    await expect(service.shared(token)).rejects.toThrow();
    expect((await service.save('org-1', { title: 'Recap', body: 'b' })).slug).toBe(
      'recap-2'
    );
  });

  it('refuses a flow without a title and bad parts', async () => {
    const { service } = memory();
    await expect(service.save('org-1', { body: 'b' })).rejects.toThrow(/title/);
    await expect(
      service.save('org-1', { title: 'T', body: 'b', parts: { 'bad key!': 'x' } })
    ).rejects.toThrow(/part/);
  });

  it('keeps reserved route words out of slugs', async () => {
    const { service } = memory();
    expect((await service.save('org-1', { title: 'Shared', body: 'b' })).slug).toBe(
      'shared-flow'
    );
  });

  it('reads one flow with its share link', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'Recap', body: 'b', parts: { a: 'x' } });
    const flow = await service.get('org-1', 'recap');
    expect(flow).toMatchObject({ slug: 'recap', parts: { a: 'x' }, shared: false, shareUrl: null });
    expect(await service.get('org-2', 'recap')).toBeNull();
    expect(await service.get('org-1', '../x')).toBeNull();
  });
});

describe('custom flows', () => {
  it('saves a flow based on a library flow, with its changes and skills', async () => {
    const { service, flows } = memory();
    const result = await service.save('org-1', {
      title: 'My carousel',
      basedOn: 'carousel',
      customization: 'Five slides, never more.',
      skills: ['hooks', 'voice', 'hooks'],
    });
    expect(result).toMatchObject({ slug: 'my-carousel', created: true });
    expect(flows[0]).toMatchObject({
      source: 'CREATED',
      basedOn: 'carousel',
      customization: 'Five slides, never more.',
      skills: ['hooks', 'voice'],
      body: '',
    });
    const [listed] = await service.list('org-1');
    expect(listed).toMatchObject({
      basedOn: 'carousel',
      skills: ['hooks', 'voice'],
      shareable: true,
    });
    // The app reads the flow as stored, to edit it.
    expect(await service.get('org-1', 'my-carousel')).toMatchObject({
      basedOn: 'carousel',
      customization: 'Five slides, never more.',
      skills: ['hooks', 'voice'],
    });
  });

  it('refuses a base or skills it cannot use', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'Recap', body: 'b' });
    await expect(
      service.save('org-1', { title: 'T', basedOn: 'my/nope' })
    ).rejects.toThrow('no flow named "my/nope" to base on');
    await expect(
      service.save('org-1', { title: 'T', basedOn: 'bad id!' })
    ).rejects.toThrow(/basedOn/);
    await expect(
      service.save('org-1', { title: 'T', basedOn: 'carousel', skills: ['nope'] })
    ).rejects.toThrow('no skill named "nope"');
    await expect(
      service.save('org-1', {
        title: 'T',
        basedOn: 'carousel',
        skills: ['a', 'b', 'c', 'd', 'e', 'f'],
      })
    ).rejects.toThrow(/at most 5 skills/);
    await expect(
      service.save('org-1', {
        title: 'T',
        basedOn: 'carousel',
        customization: 'x'.repeat(20_001),
      })
    ).rejects.toThrow(/too long/);
    // A deleted flow is no base either.
    await service.delete('org-1', 'recap');
    await expect(
      service.save('org-1', { title: 'T', basedOn: 'my/recap' })
    ).rejects.toThrow('no flow named "my/recap" to base on');
  });

  it('refuses a flow based on itself, directly or through others', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'A', body: 'A method' });
    await service.save('org-1', { title: 'B', basedOn: 'my/a' });
    await expect(
      service.update('org-1', 'a', { basedOn: 'my/a' })
    ).rejects.toThrow('a flow cannot be based on itself');
    await expect(
      service.update('org-1', 'a', { basedOn: 'my/b' })
    ).rejects.toThrow('a flow cannot be based on itself');
    await expect(
      service.save(
        'org-1',
        { slug: 'a', title: 'A', basedOn: 'my/b' },
        { overwrite: true }
      )
    ).rejects.toThrow('a flow cannot be based on itself');
  });

  it('refuses a chain longer than five of My flows', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'F0', body: 'root' });
    for (let n = 1; n <= 5; n++) {
      await service.save('org-1', { title: `F${n}`, basedOn: `my/f${n - 1}` });
    }
    await expect(
      service.save('org-1', { title: 'F6', basedOn: 'my/f5' })
    ).rejects.toThrow(/at most 5/);
  });

  it('merges a chain of My flows for the agent, the nearer flow winning', async () => {
    const { service } = memory();
    await service.save('org-1', {
      title: 'A',
      body: 'A method',
      parts: { hook: 'a hook', outro: 'a outro' },
      cost: '{{credits image 5}}',
      foundation: ['business-basics'],
      skills: ['hooks'],
    });
    await service.save('org-1', {
      title: 'B',
      basedOn: 'my/a',
      customization: 'B change',
      parts: { hook: 'b hook' },
      foundation: ['audience'],
    });
    await service.save('org-1', {
      title: 'C',
      basedOn: 'my/b',
      customization: 'C change',
      skills: ['voice'],
    });

    const flow = await service.resolved('org-1', 'c', { skillsUnlocked: true });
    expect(flow).toMatchObject({
      slug: 'c',
      title: 'C',
      basedOn: null,
      customization: 'B change\n\nC change',
      body: 'A method',
      parts: { hook: 'b hook', outro: 'a outro' },
      cost: '{{credits image 5}}',
      foundation: ['audience', 'business-basics'],
    });
    expect(flow?.skills).toEqual([
      {
        slug: 'voice',
        name: 'Your voice',
        summary: 'Write like the user',
        whenToUse: null,
        body: 'Voice steps',
      },
      {
        slug: 'hooks',
        name: 'Hooks',
        summary: 'Openers that stop the scroll',
        whenToUse: 'The first line',
        body: 'Hook steps',
      },
    ]);
  });

  it('keeps a library base by id at the end of a chain, with no body', async () => {
    const { service } = memory();
    await service.save('org-1', {
      title: 'L',
      basedOn: 'carousel',
      customization: 'L change',
      cost: '{{credits image 3}}',
    });
    await service.save('org-1', { title: 'M', basedOn: 'my/l', customization: 'M change' });
    const flow = await service.resolved('org-1', 'm', { skillsUnlocked: true });
    expect(flow).toMatchObject({
      basedOn: 'carousel',
      customization: 'L change\n\nM change',
      body: '',
      parts: null,
      cost: '{{credits image 3}}',
      skills: [],
    });
  });

  it('counts the body of a based-on flow as part of its customization', async () => {
    const { service } = memory();
    await service.save('org-1', {
      title: 'T',
      basedOn: 'carousel',
      customization: 'Change',
      body: 'Extra steps',
    });
    expect(
      await service.resolved('org-1', 't', { skillsUnlocked: true })
    ).toMatchObject({ customization: 'Change\n\nExtra steps', body: '' });
  });

  it('reads a flow of its own as stored', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'Recap', body: 'b', parts: { a: 'x' } });
    expect(
      await service.resolved('org-1', 'recap', { skillsUnlocked: true })
    ).toMatchObject({ basedOn: null, customization: '', body: 'b', parts: { a: 'x' } });
    expect(
      await service.resolved('org-1', 'nope', { skillsUnlocked: true })
    ).toBeNull();
  });

  it('locks the skills without the skills unlock and says which are gone', async () => {
    const { service, library } = memory();
    await service.save('org-1', {
      title: 'T',
      basedOn: 'carousel',
      skills: ['hooks', 'voice'],
    });
    // "voice" is turned off in the library after the save.
    library.splice(1, 1);
    const flow = await service.resolved('org-1', 't', { skillsUnlocked: false });
    expect(flow?.skills).toEqual([
      {
        slug: 'hooks',
        name: 'Hooks',
        summary: 'Openers that stop the scroll',
        whenToUse: 'The first line',
        locked: true,
      },
      { slug: 'voice', name: 'voice', summary: '', whenToUse: null, missing: true },
    ]);
  });

  it('keeps a flow that others are based on until they change', async () => {
    const { service } = memory();
    await service.save('org-1', { title: 'A', body: 'A method' });
    await service.save('org-1', { title: 'B', basedOn: 'my/a' });
    await service.save('org-1', { title: 'C', basedOn: 'my/a' });
    await expect(service.delete('org-1', 'a')).rejects.toThrow(
      '2 flows are based on this one (my/b, my/c)'
    );
    await service.delete('org-1', 'b');
    await expect(service.delete('org-1', 'a')).rejects.toThrow(
      /^1 flow is based on this one \(my\/c\)/
    );
    await service.update('org-1', 'c', { basedOn: null, body: 'Own now' });
    expect(await service.delete('org-1', 'a')).toEqual({ deleted: true });
  });

  it('shares a flow based on a library flow by reference, scrubbed, and imports it', async () => {
    const { service, flows } = memory();
    await service.save('org-1', {
      title: 'Carousel plus',
      basedOn: 'carousel',
      customization: 'Accent #FF0000 on every slide.',
      skills: ['hooks'],
    });
    const { token } = await service.share('org-1', 'carousel-plus');
    const { flow, warnings } = await service.shared(token);
    expect(flow).toMatchObject({
      basedOn: 'carousel',
      customization: "Accent the brand's accent colour on every slide.",
      skills: ['hooks'],
      body: '',
    });
    expect(warnings).toHaveLength(1);

    const result = await service.import('org-2', token);
    const copy = flows.find((f) => f.organizationId === 'org-2');
    expect(result).toMatchObject({ slug: 'carousel-plus', created: true });
    expect(copy).toMatchObject({
      source: 'IMPORTED',
      basedOn: 'carousel',
      customization: "Accent the brand's accent colour on every slide.",
      skills: ['hooks'],
      body: '',
    });
  });

  it('shares a chain of My flows merged, with no slug of the author', async () => {
    const { service, flows } = memory();
    await service.save('org-1', { title: 'A', body: 'A method', parts: { hook: 'a' } });
    await service.save('org-1', {
      title: 'B',
      basedOn: 'my/a',
      customization: 'B change',
      skills: ['voice'],
    });
    const { token } = await service.share('org-1', 'b');
    const { flow } = await service.shared(token);
    expect(flow).toMatchObject({
      title: 'B',
      basedOn: null,
      customization: 'B change',
      body: 'A method',
      parts: { hook: 'a' },
      skills: ['voice'],
    });
    expect(JSON.stringify(flow)).not.toContain('my/');
    expect(flow).not.toHaveProperty('slug');

    await service.import('org-2', token);
    expect(flows.find((f) => f.organizationId === 'org-2')).toMatchObject({
      basedOn: null,
      customization: 'B change',
      body: 'A method',
      skills: ['voice'],
    });
  });

  it('never shares a flow based on a copy of a library flow', async () => {
    const { service, repo, flows } = memory();
    await service.fork('org-1', { id: 'carousel', title: 'Carousel', body: 'Voho method' });
    await service.save('org-1', {
      title: 'Carousel custom',
      basedOn: 'my/carousel',
      customization: 'Shorter',
    });
    await expect(service.share('org-1', 'carousel-custom')).rejects.toThrow(
      /cannot be shared/
    );
    const shareable = Object.fromEntries(
      (await service.list('org-1')).map((f: any) => [f.slug, f.shareable])
    );
    expect(shareable).toEqual({ carousel: false, 'carousel-custom': false });
    // A link made some other way opens nothing either.
    await repo.createShare('org-1', flows[1].id, 'old-token');
    await expect(service.shared('old-token')).rejects.toThrow(/turned off/);
  });
});
