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

// A comment needs a live post to hang on; it does not need the post to be the
// commenter's own, since the preview page is shared with outside reviewers.
const setup = (post: any) => {
  const repository: any = {
    getPost: jest.fn(async () => post),
    createComment: jest.fn(async () => ({ id: 'c1' })),
  };
  const service = new PostsService(
    repository,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, repository };
};

describe('PostsService.createComment', () => {
  it('refuses a post that does not exist', async () => {
    const { service, repository } = setup(null);
    await expect(
      service.createComment('org-a', 'u1', 'missing', 'hi')
    ).rejects.toThrow('Post not found');
    expect(repository.createComment).not.toHaveBeenCalled();
  });

  it('records the comment under the commenter organization', async () => {
    const { service, repository } = setup({ id: 'p1' });
    await service.createComment('org-a', 'u1', 'p1', 'hi');
    expect(repository.getPost).toHaveBeenCalledWith('p1');
    expect(repository.createComment).toHaveBeenCalledWith(
      'org-a',
      'u1',
      'p1',
      'hi'
    );
  });
});
