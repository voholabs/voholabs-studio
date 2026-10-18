// The service's own module graph pulls every social provider in; none of
// that is needed to test where channel avatars are stored.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

process.env.NEXT_PUBLIC_BACKEND_URL = 'https://studio.example.com/api';

// A page picked during connect keeps its network avatar as pictureSource and
// `picture` stays the proxy URL, never a copy the bucket will expire.
describe('IntegrationRepository.updateIntegration', () => {
  const make = (existing: { id: string } | null) => {
    const integration = {
      findUnique: jest.fn(async () => existing),
      update: jest.fn(async ({ where }: any) => ({ id: where.id })),
    };
    const repository = Object.create(IntegrationRepository.prototype);
    repository._integration = { model: { integration } };
    repository._posts = { model: { post: { updateMany: jest.fn() } } };
    return { repository: repository as IntegrationRepository, integration };
  };

  it('stores the network URL as pictureSource and the proxy as picture', async () => {
    const { repository, integration } = make(null);
    await repository.updateIntegration('row-1', {
      picture: 'https://scontent.example.com/page.jpg',
      internalId: 'page-1',
      organizationId: 'org-1',
    });

    const last = integration.update.mock.calls.at(-1)![0] as any;
    expect(last.where).toEqual({ id: 'row-1' });
    expect(last.data.pictureSource).toBe(
      'https://scontent.example.com/page.jpg'
    );
    expect(last.data.picture).toBe(
      'https://studio.example.com/api/integrations/row-1/picture'
    );
    expect(last.select).toEqual({ id: true });
  });

  it('builds the proxy URL for the row it keeps when the page was connected before', async () => {
    const { repository, integration } = make({ id: 'row-old' });
    await repository.updateIntegration('row-new', {
      picture: 'https://scontent.example.com/page.jpg',
      internalId: 'page-1',
      organizationId: 'org-1',
    });

    const last = integration.update.mock.calls.at(-1)![0] as any;
    expect(last.where).toEqual({ id: 'row-old' });
    expect(last.data.picture).toBe(
      'https://studio.example.com/api/integrations/row-old/picture'
    );
  });

  it('leaves both picture columns alone when no picture is given', async () => {
    const { repository, integration } = make(null);
    await repository.updateIntegration('row-1', {
      internalId: 'page-1',
      organizationId: 'org-1',
    });

    const last = integration.update.mock.calls.at(-1)![0] as any;
    expect(last.data).not.toHaveProperty('picture');
    expect(last.data).not.toHaveProperty('pictureSource');
  });
});

describe('IntegrationService.backfillPictures', () => {
  const make = () => {
    const candidates = [
      {
        id: 'a',
        providerIdentifier: 'facebook',
        picture: 'https://pub-1.r2.dev/a.jpg',
        pictureSource: null,
      },
      {
        id: 'b',
        providerIdentifier: 'gmb',
        picture: 'https://pub-1.r2.dev/b.jpg',
        pictureSource: 'https://lh3.googleusercontent.com/account.jpg',
      },
      {
        id: 'c',
        providerIdentifier: 'x',
        picture: 'https://studio.example.com/api/integrations/c/picture',
        pictureSource: 'https://pbs.twimg.com/c.jpg',
      },
      {
        id: 'd',
        providerIdentifier: 'x',
        picture: 'https://old.example.com/api/integrations/d/picture',
        pictureSource: 'https://pbs.twimg.com/d.jpg',
      },
    ];
    const repository = {
      pictureBackfillCandidates: jest.fn(async () => candidates),
      applyPictureBackfill: jest.fn(async () => ({})),
    };
    const pictures = { invalidate: jest.fn(async () => undefined) };
    const service = Object.create(IntegrationService.prototype);
    service._integrationRepository = repository;
    service._integrationPictureService = pictures;
    return { service: service as IntegrationService, repository, pictures };
  };

  it('only reports without apply', async () => {
    const { service, repository } = make();
    expect(await service.backfillPictures(false)).toEqual({
      dryRun: true,
      channelsToUpdate: 2,
      byProvider: { facebook: 1, gmb: 1 },
    });
    expect(repository.applyPictureBackfill).not.toHaveBeenCalled();
  });

  it("points copies at the proxy and keeps the copy, the page's own avatar, as the source", async () => {
    const { service, repository, pictures } = make();
    await service.backfillPictures(true);

    expect(repository.applyPictureBackfill.mock.calls).toEqual([
      [
        'a',
        'https://studio.example.com/api/integrations/a/picture',
        'https://pub-1.r2.dev/a.jpg',
      ],
      [
        'b',
        'https://studio.example.com/api/integrations/b/picture',
        'https://pub-1.r2.dev/b.jpg',
      ],
    ]);
    expect(pictures.invalidate).toHaveBeenCalledTimes(2);
  });
});
