import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';

jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

const row = (overrides: Record<string, any> = {}) =>
  ({
    id: 'i1',
    organizationId: 'org-1',
    internalId: 'tt-1',
    rootInternalId: 'tt-1',
    providerIdentifier: 'tiktok',
    name: 'My TikTok',
    picture: 'https://pic',
    profile: 'me',
    token: 'old-access',
    refreshToken: 'old-refresh',
    tokenExpiration: new Date(Date.now() - 1000),
    refreshNeeded: false,
    deletedAt: null,
    ...overrides,
  } as any);

const setup = (
  stored: any,
  refreshToken: jest.Mock,
  refreshErrorTemporary?: (err: any) => boolean
) => {
  const integrationService = {
    getIntegrationById: jest.fn().mockResolvedValue(stored),
    createOrUpdateIntegration: jest.fn().mockResolvedValue({}),
    refreshNeeded: jest.fn(),
    informAboutRefreshError: jest.fn(),
  };
  const integrationManager = {
    getSocialIntegration: () => ({ refreshToken, refreshErrorTemporary }),
  };
  const service = new RefreshIntegrationService(
    integrationManager as any,
    integrationService as any,
    {} as any
  );
  return { service, integrationService };
};

describe('RefreshIntegrationService.refresh', () => {
  it('reuses a token another refresh already stored instead of refreshing again', async () => {
    const refreshToken = jest.fn();
    const { service, integrationService } = setup(
      row({
        token: 'new-access',
        refreshToken: 'new-refresh',
        tokenExpiration: new Date(Date.now() + 60 * 60 * 1000),
      }),
      refreshToken
    );

    const result = await service.refresh(row());

    expect(refreshToken).not.toHaveBeenCalled();
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('refreshes with the stored refresh token, not the caller copy', async () => {
    const refreshToken = jest.fn().mockResolvedValue({
      id: 'tt-1',
      name: '',
      username: '',
      accessToken: 'next-access',
      refreshToken: 'next-refresh',
      expiresIn: 3600,
    });
    const { service, integrationService } = setup(
      row({ refreshToken: 'stored-refresh' }),
      refreshToken
    );

    await service.refresh(row({ refreshToken: 'stale-refresh' }));

    expect(refreshToken).toHaveBeenCalledWith('stored-refresh');
    expect(
      integrationService.createOrUpdateIntegration.mock.calls[0][9]
    ).toBe('next-refresh');
  });

  const isTemporary = (err: any) =>
    !`${err?.message}`.includes('invalid_grant');

  it('retries a temporary failure and keeps the channel connected', async () => {
    const refreshToken = jest
      .fn()
      .mockRejectedValue(new Error('server_error: try later'));
    const { service, integrationService } = setup(
      row(),
      refreshToken,
      isTemporary
    );

    const result = await service.refresh(row());

    expect(result).toBe(false);
    expect(refreshToken).toHaveBeenCalledTimes(3);
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(integrationService.informAboutRefreshError).not.toHaveBeenCalled();
  });

  it('recovers when a retry goes through', async () => {
    const refreshToken = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporarily_unavailable: '))
      .mockResolvedValue({
        id: 'tt-1',
        name: '',
        username: '',
        accessToken: 'next-access',
        refreshToken: 'next-refresh',
        expiresIn: 3600,
      });
    const { service, integrationService } = setup(
      row(),
      refreshToken,
      isTemporary
    );

    const result = await service.refresh(row());

    expect(result).toMatchObject({ accessToken: 'next-access' });
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
  });

  it('asks for a reconnect when the refresh token is dead', async () => {
    const refreshToken = jest
      .fn()
      .mockRejectedValue(new Error('invalid_grant: revoked'));
    const { service, integrationService } = setup(
      row(),
      refreshToken,
      isTemporary
    );

    const result = await service.refresh(row());

    expect(result).toBe(false);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(integrationService.refreshNeeded).toHaveBeenCalledWith('org-1', 'i1');
  });
});
