import { PostRevisionService } from '@gitroom/nestjs-libraries/database/prisma/post-revisions/post-revision.service';

// An in-memory stand-in for PostRevisionRepository, enough to follow one
// post through its saves.
const memoryRepository = () => {
  const revisions: any[] = [];
  const versions: any[] = [];
  return {
    revisions,
    versions,
    findChainByPostIds: async (orgId: string, postIds: string[]) =>
      revisions.find(
        (r) =>
          r.organizationId === orgId &&
          !r.deletedAt &&
          r.postIds.some((id: string) => postIds.includes(id))
      ) || null,
    findChainByGroup: async (orgId: string, group?: string) =>
      revisions.find(
        (r) => r.organizationId === orgId && !r.deletedAt && r.group === group
      ) || null,
    getChain: async (orgId: string, chainId: string) =>
      revisions.filter(
        (r) => r.organizationId === orgId && r.chainId === chainId
      ),
    create: async (data: any) => {
      const row = { id: `r${revisions.length}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      revisions.push(row);
      return row;
    },
    refreshLinking: async (id: string, group: string, postIds: string[]) =>
      Object.assign(revisions.find((r) => r.id === id), { group, postIds }),
    upsertFinal: async (orgId: string, chainId: string, data: any) => {
      const final = revisions.find(
        (r) => r.chainId === chainId && r.kind === 'FINAL'
      );
      if (final) {
        return Object.assign(final, data, { updatedAt: new Date() });
      }
      const row = { id: `r${revisions.length}`, organizationId: orgId, chainId, kind: 'FINAL', createdAt: new Date(), updatedAt: new Date(), ...data };
      revisions.push(row);
      return row;
    },
    stampPublished: async (id: string, publishedAt: Date) =>
      Object.assign(revisions.find((r) => r.id === id), { publishedAt }),
    markChainDeleted: async (orgId: string, chainId: string) => {
      revisions
        .filter((r) => r.chainId === chainId)
        .forEach((r) => (r.deletedAt = new Date()));
    },
    latestVersion: async (chainId: string) => {
      const list = versions.filter((v) => v.chainId === chainId);
      return list.length ? list[list.length - 1] : null;
    },
    createVersion: async (data: any) => {
      if (versions.some((v) => v.chainId === data.chainId && v.version === data.version)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      versions.push(data);
      return data;
    },
    getVersions: async (orgId: string, chainId: string) =>
      versions.filter((v) => v.chainId === chainId),
  };
};

const save = (
  service: PostRevisionService,
  content: string,
  group: string,
  oldGroup?: string,
  date = '2026-10-20T10:00:00.000Z'
) =>
  service.captureSnapshot({
    orgId: 'org',
    oldGroup,
    newGroup: group,
    postIds: ['p1'],
    integrationId: 'int',
    publishDate: date,
    value: [{ content, image: [] }],
    settings: {},
  });

const contents = (repository: ReturnType<typeof memoryRepository>) =>
  repository.versions.map(
    (v) => `v${v.version}:${JSON.parse(v.payload).value[0].content}`
  );

describe('PostRevisionService versions', () => {
  it('keeps every distinct save as a version, from v1', async () => {
    const repository = memoryRepository();
    const service = new PostRevisionService(repository as any);
    await save(service, 'first draft', 'g1');
    await save(service, 'first draft', 'g2', 'g1'); // no change
    await save(service, 'edited', 'g3', 'g2');
    await save(service, 'edited again', 'g4', 'g3');
    expect(contents(repository)).toEqual([
      'v1:first draft',
      'v2:edited',
      'v3:edited again',
    ]);
    // INITIAL and FINAL still hold the first and the latest
    const initial = repository.revisions.find((r) => r.kind === 'INITIAL');
    const final = repository.revisions.find((r) => r.kind === 'FINAL');
    expect(JSON.parse(initial.payload).value[0].content).toBe('first draft');
    expect(JSON.parse(final.payload).value[0].content).toBe('edited again');
  });

  it('keeps recording versions after the post went out, with FINAL frozen', async () => {
    const repository = memoryRepository();
    const service = new PostRevisionService(repository as any);
    await save(service, 'draft', 'g1');
    await save(service, 'what went out', 'g2', 'g1');
    await service.markPublished('org', 'p1', 'g2');
    await save(service, 'changed afterwards', 'g3', 'g2');
    const final = repository.revisions.find((r) => r.kind === 'FINAL');
    expect(JSON.parse(final.payload).value[0].content).toBe('what went out');
    expect(contents(repository)).toEqual([
      'v1:draft',
      'v2:what went out',
      'v3:changed afterwards',
    ]);
  });

  it('keeps the history when the post is deleted', async () => {
    const repository = memoryRepository();
    const service = new PostRevisionService(repository as any);
    await save(service, 'draft', 'g1');
    await save(service, 'edited', 'g2', 'g1');
    const { chainId } = repository.revisions[0];
    await service.markChainDeleted('org', chainId);
    expect(repository.revisions.every((r) => r.deletedAt)).toBe(true);
    expect(contents(repository)).toEqual(['v1:draft', 'v2:edited']);
    // A deleted chain is never picked up again
    expect(await service.resolveChainId('org', ['p1'], 'g2')).toBeUndefined();
  });

  it('records a reschedule as a version with the same content', async () => {
    const repository = memoryRepository();
    const service = new PostRevisionService(repository as any);
    await save(service, 'draft', 'g1');
    await service.captureReschedule('org', 'p1', 'g1', '2026-10-21T09:00:00.000Z');
    expect(repository.versions).toHaveLength(2);
    expect(JSON.parse(repository.versions[1].payload).publishDate).toBe(
      '2026-10-21T09:00:00.000Z'
    );
    expect(repository.versions[1].contentHash).toBe(
      repository.versions[0].contentHash
    );
  });

  it('gives a chain recorded before versions its INITIAL and FINAL first', async () => {
    const repository = memoryRepository();
    const service = new PostRevisionService(repository as any);
    await save(service, 'draft', 'g1');
    await save(service, 'edited', 'g2', 'g1');
    // As if both were written before versions existed
    repository.versions.length = 0;
    await save(service, 'edited again', 'g3', 'g2');
    expect(contents(repository)).toEqual([
      'v1:draft',
      'v2:edited',
      'v3:edited again',
    ]);
  });
});
