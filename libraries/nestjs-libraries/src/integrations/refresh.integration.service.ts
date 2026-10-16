import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { timer } from '@gitroom/helpers/utils/timer';

@Injectable()
export class RefreshIntegrationService {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  async refresh(integration: Integration, cause = ''): Promise<false | AuthTokenDetails> {
    // Several posts (and the editor) can hit the same expired token at once.
    // Providers like TikTok hand back a new refresh token on every refresh, so
    // two refreshes with the same old token race: one wins and the other is
    // rejected, which used to mark a working channel as disconnected. Only one
    // refresh per channel runs at a time, and it starts from the stored row.
    const lockKey = `refresh-token-lock:${integration.id}`;
    const locked = await this.acquireRefreshLock(lockKey);

    try {
      const latest =
        (await this._integrationService.getIntegrationById(
          integration.organizationId,
          integration.id
        )) || integration;

      // another refresh finished while this caller held an old copy
      if (
        latest.token !== integration.token &&
        !latest.refreshNeeded &&
        !latest.deletedAt &&
        latest.tokenExpiration &&
        latest.tokenExpiration > new Date()
      ) {
        return {
          id: latest.internalId,
          name: latest.name,
          picture: latest.picture || '',
          username: latest.profile || '',
          accessToken: latest.token,
          refreshToken: latest.refreshToken || undefined,
        };
      }

      const socialProvider = this._integrationManager.getSocialIntegration(
        latest.providerIdentifier
      );

      const refresh = await this.refreshProcess(latest, socialProvider, cause);

      if (!refresh) {
        return false as const;
      }

      await this._integrationService.createOrUpdateIntegration(
        undefined,
        !!socialProvider.oneTimeToken,
        latest.organizationId,
        latest.name,
        latest.picture!,
        'social',
        latest.internalId,
        latest.providerIdentifier,
        refresh.accessToken,
        refresh.refreshToken,
        refresh.expiresIn
      );

      return refresh;
    } finally {
      if (locked) {
        await ioRedis.del(lockKey).catch(() => undefined);
      }
    }
  }

  // Waits up to 30 seconds for another refresh of the same channel to finish,
  // then refreshes anyway. A Redis error also skips the guard.
  private async acquireRefreshLock(key: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const claimed = await ioRedis
        .set(key, '1', 'EX', 60, 'NX')
        .then((r) => r === 'OK')
        .catch(() => undefined);

      if (claimed !== false) {
        return !!claimed;
      }

      await timer(1000);
    }

    return false;
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    await this._integrationService.setBetweenRefreshSteps(integration.id);
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
  }

  public async startRefreshWorkflow(orgId: string, id: string, integration: SocialProvider) {
    if (!integration.refreshCron) {
      return false;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start(`refreshTokenWorkflow`, {
        workflowId: `refresh_${id}`,
        args: [{integrationId: id, organizationId: orgId}],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      });
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider,
    cause = ''
  ): Promise<AuthTokenDetails | false> {
    let refreshError: any = undefined;
    let refresh: false | AuthTokenDetails = false;
    let temporary = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      refreshError = undefined;
      refresh = await socialProvider
        .refreshToken(integration.refreshToken!)
        .catch((err) => {
          refreshError = err;
          return false as const;
        });

      temporary =
        !!refreshError && !!socialProvider.refreshErrorTemporary?.(refreshError);

      if (refresh || !temporary || attempt === 3) {
        break;
      }

      await timer(attempt * 5000);
    }

    if (!refresh || !refresh.accessToken) {
      if (refreshError) {
        console.error(
          `Could not refresh ${integration.providerIdentifier} integration ${integration.id}`,
          refreshError?.response?.data || refreshError?.message || refreshError
        );
      }

      // the platform is having a moment, the refresh token itself is fine:
      // this attempt fails, but the channel stays connected
      if (temporary) {
        return false;
      }

      // informAboutRefreshError (with the failure cause) already notifies
      // the user, and refreshNeeded sets the same flag disconnectChannel
      // would — calling disconnectChannel here sent a second, cause-less
      // copy of the same email for every failed refresh.
      await this._integrationService.refreshNeeded(
        integration.organizationId,
        integration.id
      );

      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        socialProvider.refreshErrorMessage?.(refreshError) || cause
      );

      return false;
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    let reConnect;
    try {
      reConnect = await socialProvider.reConnect(
        integration.rootInternalId,
        integration.internalId,
        refresh.accessToken
      );
    } catch (err: any) {
      console.error(
        `Could not reconnect ${integration.providerIdentifier} integration ${integration.id} after a successful token refresh`,
        err?.response?.data || err?.message || err
      );
      throw err;
    }

    return {
      ...refresh,
      ...reConnect,
    };
  }
}
