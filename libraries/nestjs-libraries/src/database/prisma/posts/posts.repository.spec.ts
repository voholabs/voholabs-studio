// Every write PostsRepository makes on behalf of a request stays inside the
// caller's organization. Plain stubs stand in for Prisma; only the where
// clauses are looked at.
jest.mock('@gitroom/nestjs-libraries/dtos/posts/create.post.dto', () => ({}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {},
}));
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

const model = () => ({
  upsert: jest.fn(async (args: any) => ({
    id: args.where.id,
    group: 'new-group',
  })),
  update: jest.fn(async () => ({})),
  updateMany: jest.fn(async () => ({ count: 0 })),
  deleteMany: jest.fn(async () => ({ count: 0 })),
  findFirst: jest.fn(async () => ({ id: 'first', group: 'g1' })),
  findMany: jest.fn(async () => [{ id: 'tag-1' }]),
  create: jest.fn(async () => ({})),
});

const setup = () => {
  const post = model();
  const tags = model();
  const tagsPosts = model();
  const comments = model();
  const repository = new PostsRepository(
    { model: { post } } as any,
    { model: { popularPosts: model() } } as any,
    { model: { comments } } as any,
    { model: { tags } } as any,
    { model: { tagsPosts } } as any,
    { model: { errors: model() } } as any,
    { model: { organization: model() } } as any
  );
  return { repository, post, tags, tagsPosts, comments };
};

const body: any = {
  group: 'g1',
  integration: { id: 'i1' },
  settings: { __type: 'x' },
  value: [
    { id: 'existing-1', content: 'one', image: [] },
    { id: 'existing-2', content: 'two', image: [] },
  ],
};

describe('PostsRepository.createOrUpdatePost', () => {
  it('only upserts posts of the caller organization', async () => {
    const { repository, post } = setup();
    await repository.createOrUpdatePost(
      'schedule',
      'org-a',
      '2026-10-10T10:00:00',
      body,
      [],
      'APP' as any
    );

    expect(post.upsert).toHaveBeenCalledTimes(2);
    for (const [args] of post.upsert.mock.calls as any[]) {
      expect(args.where.organizationId).toBe('org-a');
      expect(args.create.organization.connect.id).toBe('org-a');
      expect(args.create.integration.connect.organizationId).toBe('org-a');
    }
    expect((post.upsert.mock.calls[0] as any)[0].where.id).toBe('existing-1');
  });

  it('scopes the replaced group lookup and soft delete to the organization', async () => {
    const { repository, post } = setup();
    await repository.createOrUpdatePost(
      'schedule',
      'org-a',
      '2026-10-10T10:00:00',
      body,
      [],
      'APP' as any
    );

    expect(post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-a', group: 'g1' }),
      })
    );
    expect(post.updateMany).toHaveBeenCalledTimes(1);
    expect((post.updateMany.mock.calls[0] as any)[0].where).toEqual({
      organizationId: 'org-a',
      group: 'g1',
      deletedAt: null,
    });
  });

  it('scopes tag rewrites to the organization', async () => {
    const { repository, post, tagsPosts, tags } = setup();
    await repository.createOrUpdatePost(
      'schedule',
      'org-a',
      '2026-10-10T10:00:00',
      body,
      [{ value: 't', label: 'tag' }],
      'APP' as any
    );

    expect((tagsPosts.deleteMany.mock.calls[0] as any)[0].where.post).toEqual({
      id: 'existing-1',
      organizationId: 'org-a',
    });
    expect((tags.findMany.mock.calls[0] as any)[0].where.orgId).toBe('org-a');
    expect((post.update.mock.calls[0] as any)[0].where).toEqual({
      id: 'existing-1',
      organizationId: 'org-a',
    });
  });

  it('leaves other groups alone when no group is sent', async () => {
    const { repository, post } = setup();
    await repository.createOrUpdatePost(
      'draft',
      'org-a',
      '2026-10-10T10:00:00',
      { ...body, group: undefined },
      [],
      'APP' as any
    );
    expect(post.updateMany).not.toHaveBeenCalled();
    expect(post.findFirst).not.toHaveBeenCalled();
  });
});

describe('PostsRepository organization scoping', () => {
  it('scopes deletePost', async () => {
    const { repository, post } = setup();
    await repository.deletePost('org-a', 'g1');
    expect((post.updateMany.mock.calls[0] as any)[0].where).toEqual({
      organizationId: 'org-a',
      group: 'g1',
    });
  });

  it('scopes setReviewed', async () => {
    const { repository, post } = setup();
    await repository.setReviewed('org-a', 'p1', true);
    expect((post.findFirst.mock.calls[0] as any)[0].where.organizationId).toBe(
      'org-a'
    );
    expect(
      (post.updateMany.mock.calls[0] as any)[0].where.organizationId
    ).toBe('org-a');
  });

  it('scopes editTag and deleteTag', async () => {
    const { repository, tags } = setup();
    await repository.editTag('t1', 'org-a', { name: 'n', color: 'c' } as any);
    await repository.deleteTag('t1', 'org-a');
    expect((tags.update.mock.calls[0] as any)[0].where).toEqual({
      id: 't1',
      orgId: 'org-a',
    });
    expect((tags.update.mock.calls[1] as any)[0].where).toEqual({
      id: 't1',
      orgId: 'org-a',
    });
  });

  it('scopes changeDate and updateReleaseId', async () => {
    const { repository, post } = setup();
    await repository.changeDate('org-a', 'p1', '2026-10-10T10:00:00', false);
    await repository.updateReleaseId('p1', 'org-a', '123');
    for (const [args] of post.update.mock.calls as any[]) {
      expect(args.where.organizationId).toBe('org-a');
    }
  });

  it('records a comment under the commenter organization', async () => {
    const { repository, comments } = setup();
    await repository.createComment('org-a', 'u1', 'p1', 'hi');
    expect((comments.create.mock.calls[0] as any)[0].data).toEqual({
      organizationId: 'org-a',
      userId: 'u1',
      postId: 'p1',
      content: 'hi',
    });
  });
});
