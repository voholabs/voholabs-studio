// The service's own module graph pulls every social provider in; none of
// that is needed to test renewing channel avatars.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({ IntegrationRepository: class {} })
);
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

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// Avatars copied into the bucket broke where the copy was removed. Renewing
// copies the current network avatar again, only for copies that are gone.
describe('IntegrationService.renewPictures', () => {
  const channels = [
    {
      id: 'gone',
      providerIdentifier: 'facebook',
      picture: 'https://pub-1.r2.dev/gone.jpg',
    },
    {
      id: 'kept',
      providerIdentifier: 'instagram',
      picture: 'https://pub-1.r2.dev/kept.jpg',
    },
    {
      id: 'lost',
      providerIdentifier: 'gmb',
      picture: 'https://pub-1.r2.dev/lost.jpg',
    },
  ];

  const make = () => {
    const repository = {
      bucketPictureChannels: jest.fn(async () => channels),
      updatePicture: jest.fn(async () => ({ id: '' })),
    };
    const pictures = {
      networkPicture: jest.fn(async (id: string) =>
        id === 'lost' ? null : `https://scontent.example.com/${id}.jpg`
      ),
    };
    const storage = {
      uploadSimple: jest.fn(async () => 'https://pub-1.r2.dev/new.jpg'),
    };
    const service = Object.create(IntegrationService.prototype);
    service._integrationRepository = repository;
    service._integrationPictureService = pictures;
    service.storage = storage;
    return { service: service as IntegrationService, repository, storage };
  };

  beforeEach(() => {
    global.fetch = jest.fn(async (url: string) => ({
      status: url.includes('kept') ? 200 : 404,
    })) as any;
  });

  it('only reports the missing copies without apply', async () => {
    const { service, repository, storage } = make();
    expect(await service.renewPictures(false)).toEqual({
      dryRun: true,
      checked: 3,
      missing: 2,
      missingByProvider: { facebook: 1, gmb: 1 },
      renewed: 0,
      failed: [],
    });
    expect(storage.uploadSimple).not.toHaveBeenCalled();
    expect(repository.updatePicture).not.toHaveBeenCalled();
  });

  it('copies the network avatar again for a missing copy and leaves the others', async () => {
    const { service, repository, storage } = make();
    const result = await service.renewPictures(true);

    expect(storage.uploadSimple).toHaveBeenCalledWith(
      'https://scontent.example.com/gone.jpg'
    );
    expect(repository.updatePicture.mock.calls).toEqual([
      [
        'gone',
        'https://pub-1.r2.dev/new.jpg',
        'https://scontent.example.com/gone.jpg',
      ],
    ]);
    expect(result.renewed).toBe(1);
    expect(result.failed).toEqual(['lost']);
  });

  it('reports a failed copy instead of stopping the run', async () => {
    const { service, storage } = make();
    storage.uploadSimple.mockRejectedValueOnce(new Error('Unsafe URL'));

    const result = await service.renewPictures(true);
    expect(result.failed).toEqual(['gone', 'lost']);
    expect(result.renewed).toBe(0);
  });
});
