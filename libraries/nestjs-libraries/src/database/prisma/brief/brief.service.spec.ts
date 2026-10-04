jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);

import { BadRequestException } from '@nestjs/common';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';

// BriefService.deleteDocument with stub repositories: a plain delete wipes the
// document's history, keepHistory records the removal in it instead.

const ORG = 'org-1';

const build = () => {
  const repository = {
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
      { v: 1, blocks: [] }
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
