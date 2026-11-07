import {
  stripFrontMatter,
  UserSkillsService,
} from '@gitroom/nestjs-libraries/database/prisma/user-skills/user-skills.service';

// The repository's methods over plain arrays: no database. "flows" holds the
// skills index of each live flow, for the delete guard.
const memory = () => {
  const skills: any[] = [];
  const flows: { organizationId: string; slug: string; skills: string[] }[] = [];
  let ids = 0;
  const live = (organizationId: string) =>
    skills.filter((k) => k.organizationId === organizationId && !k.deletedAt);
  const whole = (k: any) => ({
    slug: k.slug,
    name: k.name,
    description: k.description,
    body: k.body,
    updatedAt: k.updatedAt,
  });
  const repo = {
    list: jest.fn(async (organizationId: string) =>
      live(organizationId).map(({ slug, name, description, updatedAt }) => ({
        slug,
        name,
        description,
        updatedAt,
      }))
    ),
    get: jest.fn(async (organizationId: string, slug: string) => {
      const k = live(organizationId).find((one) => one.slug === slug);
      return k ? whole(k) : null;
    }),
    bySlugs: jest.fn(async (organizationId: string, slugs: string[]) =>
      live(organizationId)
        .filter((k) => slugs.includes(k.slug))
        .map(whole)
    ),
    countLive: jest.fn(async (organizationId: string) => live(organizationId).length),
    importedCopies: jest.fn(async (organizationId: string, shareId: string) =>
      live(organizationId)
        .filter((k) => k.importedShareId === shareId)
        .map((k) => ({ slug: k.slug, name: k.name }))
    ),
    slugRow: jest.fn(async (organizationId: string, slug: string) => {
      const k = skills.find(
        (one) => one.organizationId === organizationId && one.slug === slug
      );
      return k ? { id: k.id, deletedAt: k.deletedAt } : null;
    }),
    slugsLike: jest.fn(async (organizationId: string, slug: string) =>
      skills
        .filter((k) => k.organizationId === organizationId && k.slug.startsWith(slug))
        .map((k) => ({ slug: k.slug }))
    ),
    flowsUsing: jest.fn(async (organizationId: string, reference: string) =>
      flows
        .filter(
          (f) => f.organizationId === organizationId && f.skills.includes(reference)
        )
        .map((f) => ({ slug: f.slug }))
    ),
    create: jest.fn(async (organizationId: string, slug: string, data: any) => {
      if (skills.some((k) => k.organizationId === organizationId && k.slug === slug)) {
        throw new Error('unique');
      }
      const k = {
        id: `k${++ids}`,
        organizationId,
        slug,
        deletedAt: null,
        updatedAt: new Date(),
        ...data,
      };
      skills.push(k);
      return whole(k);
    }),
    update: jest.fn(async (id: string, data: any) => {
      const k = skills.find((one) => one.id === id);
      Object.assign(k, data);
      return whole(k);
    }),
    softDelete: jest.fn(async (id: string) => {
      skills.find((one) => one.id === id).deletedAt = new Date();
      return { id };
    }),
  };
  return { repo, skills, flows, service: new UserSkillsService(repo as any) };
};

describe('stripFrontMatter', () => {
  it('takes out a leading front matter block only', () => {
    expect(
      stripFrontMatter('---\nname: Brand tone\ndescription: "How"\n---\n# Steps\n---\nkept')
    ).toBe('# Steps\n---\nkept');
    expect(stripFrontMatter('---\r\nname: x\r\n---\r\nBody')).toBe('Body');
    expect(stripFrontMatter('# No front matter\n---\nx')).toBe(
      '# No front matter\n---\nx'
    );
  });
});

describe('UserSkillsService', () => {
  it('creates a skill with a slug from its name, then a free one next to it', async () => {
    const { service, skills } = memory();
    expect(
      await service.create('org-1', {
        name: '  Brand tone ',
        description: ' How we sound ',
        body: '---\nname: Brand tone\n---\n\nWarm and short.\n',
      })
    ).toMatchObject({
      slug: 'brand-tone',
      name: 'Brand tone',
      description: 'How we sound',
      body: 'Warm and short.',
    });
    expect(skills[0].importedShareId).toBeNull();
    expect(
      (await service.create('org-1', { name: 'Brand tone', body: 'b' })).slug
    ).toBe('brand-tone-2');
    expect((await service.create('org-1', { name: '!!!', body: 'b' })).slug).toBe(
      'skill'
    );
    // Another workspace has its own slugs.
    expect(
      (await service.create('org-2', { name: 'Brand tone', body: 'b' })).slug
    ).toBe('brand-tone');
  });

  it('refuses a skill without a name, too long, or past 50', async () => {
    const { service } = memory();
    await expect(service.create('org-1', { name: '  ', body: 'b' })).rejects.toThrow(
      'A skill needs a name.'
    );
    await expect(
      service.create('org-1', { name: 'Long', body: 'x'.repeat(50_001) })
    ).rejects.toThrow('The skill is too long: at most 50,000 characters.');
    for (let n = 0; n < 50; n++) {
      await service.create('org-1', { name: `Skill ${n}`, body: 'b' });
    }
    await expect(
      service.create('org-1', { name: 'One more', body: 'b' })
    ).rejects.toThrow(
      'My skills holds at most 50 skills. Delete one to add another.'
    );
  });

  it('edits only the fields given and keeps the slug on a rename', async () => {
    const { service } = memory();
    await service.create('org-1', { name: 'Brand tone', description: 'd', body: 'b' });
    expect(
      await service.update('org-1', 'brand-tone', { name: 'Voice and tone' })
    ).toMatchObject({ slug: 'brand-tone', name: 'Voice and tone', description: 'd', body: 'b' });
    await expect(
      service.update('org-1', 'nope', { name: 'x' })
    ).rejects.toThrow('Skill not found');
    await expect(
      service.update('org-2', 'brand-tone', { name: 'x' })
    ).rejects.toThrow('Skill not found');
  });

  it('deletes a skill no flow brings in, and never hands its slug out again', async () => {
    const { service, flows } = memory();
    await service.create('org-1', { name: 'Brand tone', body: 'b' });
    flows.push({ organizationId: 'org-1', slug: 'post', skills: ['my/brand-tone'] });
    await expect(service.delete('org-1', 'brand-tone')).rejects.toThrow(
      '1 flow uses this skill (my/post). Remove it from that flow first.'
    );
    flows.push({ organizationId: 'org-1', slug: 'reel', skills: ['hooks', 'my/brand-tone'] });
    await expect(service.delete('org-1', 'brand-tone')).rejects.toThrow(
      '2 flows use this skill (my/post, my/reel). Remove it from them first.'
    );
    flows.length = 0;
    expect(await service.delete('org-1', 'brand-tone')).toEqual({ deleted: true });
    expect(await service.get('org-1', 'brand-tone')).toBeNull();
    expect(await service.list('org-1')).toEqual([]);
    expect(
      (await service.create('org-1', { name: 'Brand tone', body: 'b' })).slug
    ).toBe('brand-tone-2');
  });

  it('reads the live skills among slugs, ignoring bad ones', async () => {
    const { service, repo } = memory();
    await service.create('org-1', { name: 'Brand tone', body: 'b' });
    expect(
      (await service.bySlugs('org-1', ['brand-tone', 'nope', '../x'])).map((k) => k.slug)
    ).toEqual(['brand-tone']);
    expect(await service.bySlugs('org-1', ['../x'])).toEqual([]);
    expect(repo.bySlugs).toHaveBeenCalledTimes(1);
  });

  it('plans the copies of an imported flow without writing, and says when one was renamed or left out', async () => {
    const { service, skills, repo } = memory();
    await service.create('org-2', { name: 'Brand tone', body: 'Mine' });
    for (let n = 0; n < 47; n++) {
      await service.create('org-2', { name: `Skill ${n}`, body: 'b' });
    }
    repo.create.mockClear();
    const plan = await service.planImport('org-2', 'share-1', [
      { slug: 'my/brand-tone', name: 'Brand tone', description: 'd', body: '---\nname: x\n---\nTone' },
      { slug: 'my/offer', name: '', description: '', body: 'Offer' },
      { slug: 'my/extra', name: 'Extra', description: '', body: 'Extra' },
    ]);
    expect(repo.create).not.toHaveBeenCalled();
    expect(skills).toHaveLength(48);
    expect(plan.references).toEqual({
      'my/brand-tone': 'my/brand-tone-2',
      'my/offer': 'my/offer',
      'my/extra': 'my/extra',
    });
    // A name the scrub emptied falls back to the slug.
    expect(plan.create).toEqual([
      { slug: 'brand-tone-2', name: 'Brand tone', description: 'd', body: 'Tone' },
      { slug: 'offer', name: 'offer', description: '', body: 'Offer' },
    ]);
    expect(plan.warnings).toEqual([
      'The skill "Brand tone" is saved in My skills as "my/brand-tone-2", since "my/brand-tone" was taken.',
      'My skills holds at most 50 skills, so "Extra" was not copied; the flow runs without it.',
    ]);
  });

  it('keeps two planned copies apart and reuses the copy of an earlier import', async () => {
    const { service, skills } = memory();
    const twins = await service.planImport('org-2', 'share-1', [
      { slug: 'my/a', name: 'Tone', description: '', body: 'A' },
      { slug: 'my/b', name: 'Tone', description: '', body: 'B' },
    ]);
    expect(twins.create.map((one) => one.slug)).toEqual(['a', 'b']);
    // The first import wrote its copy; the same share again reuses it.
    skills.push({
      id: 'k1',
      organizationId: 'org-2',
      slug: 'brand-tone-2',
      name: 'Brand tone',
      description: '',
      body: 'Tone',
      importedShareId: 'share-1',
      deletedAt: null,
    });
    const again = await service.planImport('org-2', 'share-1', [
      { slug: 'my/brand-tone', name: 'Brand tone', description: '', body: 'Tone' },
    ]);
    expect(again).toEqual({
      references: { 'my/brand-tone': 'my/brand-tone-2' },
      create: [],
      warnings: [],
    });
    // Another share does not.
    expect(
      (
        await service.planImport('org-2', 'share-2', [
          { slug: 'my/brand-tone', name: 'Brand tone', description: '', body: 'Tone' },
        ])
      ).create
    ).toHaveLength(1);
  });
});
