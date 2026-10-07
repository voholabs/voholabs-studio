import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { ConnectIntegrationDto } from '@gitroom/nestjs-libraries/dtos/integrations/connect.integration.dto';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { NotEnoughScopesFilter } from '@gitroom/nestjs-libraries/integrations/integration.missing.scopes';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AuthTokenDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { IntegrationPictureService } from '@gitroom/nestjs-libraries/integrations/integration.picture.service';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { paidOnlyChannelMessage } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import {
  canFinishConnect,
  ConnectStateRecord,
  connectStateKey,
  CONNECT_STATE_TTL_SECONDS,
  parseConnectState,
  serializeConnectState,
} from '@gitroom/nestjs-libraries/integrations/connect.state';

@ApiTags('Integrations')
@Controller('/integrations')
export class NoAuthIntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _organizationService: OrganizationService,
    private _integrationPictureService: IntegrationPictureService,
    private _walletService: WalletService,
    private _usersService: UsersService
  ) {}

  /**
   * A connect started from a signed-in session can only be finished by a
   * signed-in member of the organization it was started for, so a channel only
   * ever lands in a workspace its owner belongs to. Reads the same `auth`
   * cookie or header the rest of the app does. See connect.state.ts.
   */
  private async assertConnectAllowed(req: Request, record: ConnectStateRecord) {
    const allowed = await canFinishConnect(
      record,
      (req.headers?.auth as string) || req.cookies?.auth,
      {
        verifyJWT: (token) => AuthService.verifyJWT(token),
        getUserById: (id) => this._usersService.getUserById(id),
        getOrgsByUserId: (userId) =>
          this._organizationService.getOrgsByUserId(userId),
      }
    );

    if (!allowed) {
      const msg =
        'Sign in to the workspace that started this connection, then try again';
      throw new HttpException({ msg, message: msg }, 403);
    }
  }

  /**
   * A channel's avatar, proxied from the network.
   *
   * Unauthenticated on purpose, and it has to be: the same picture is rendered
   * on the public preview page. Nothing here is private - it is the same image
   * the network already serves to anyone - and the only thing the id reveals is
   * that a channel exists.
   *
   * On a miss it falls through to the placeholder rather than erroring, so a
   * revoked token or a deleted account shows the default avatar instead of a
   * broken image.
   */
  @Get('/:id/picture')
  async getIntegrationPicture(@Param('id') id: string, @Res() res: Response) {
    const picture = await this._integrationPictureService.getPicture(id);

    if (!picture) {
      res.redirect(302, `${process.env.FRONTEND_URL}/no-picture.jpg`);
      return;
    }

    res.setHeader('Content-Type', picture.contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // The proxy already caches in Redis for a day; letting the browser hold it
    // for an hour keeps a calendar full of channels from re-asking on every
    // navigation, while still picking up a changed avatar the same day.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(picture.buffer);
  }

  @Get('/')
  getIntegrations() {
    return this._integrationManager.getAllIntegrations();
  }

  @Post('/social-connect/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @UseFilters(new NotEnoughScopesFilter())
  async connectSocialMedia(
    @Req() req: Request,
    @Param('integration') integration: string,
    @Body() body: ConnectIntegrationDto
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new Error('Integration not allowed');
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    const getCodeVerifier = integrationProvider.customFields
      ? 'none'
      : await ioRedis.get(`login:${body.state}`);
    if (!getCodeVerifier) {
      throw new Error('Invalid state');
    }

    const stateRecord = parseConnectState(
      await ioRedis.get(connectStateKey(body.state))
    );
    // A record that already carries a channel has been used: it is only good
    // for choosing that channel's page now.
    if (!stateRecord || stateRecord.integrationId) {
      throw new Error('Organization not found');
    }

    await this.assertConnectAllowed(req, stateRecord);

    const organization = stateRecord.orgId;
    const org = await this._organizationService.getOrgById(organization);

    // X is unavailable on the free plan, however the connection
    // was started (app, public API, CLI).
    if (
      !(await this._integrationService.canUseProvider(
        organization,
        integration
      ))
    ) {
      throw await this._walletService.providerLocked(
        organization,
        integration,
        paidOnlyChannelMessage()
      );
    }

    // A workspace paying for X from its wallet pays for the account lookup
    // made while connecting.
    const connectCharge = await this._integrationService.chargeConnectLookup(
      organization,
      integration,
      body.state
    );

    if (!integrationProvider.customFields) {
      await ioRedis.del(`login:${body.state}`);
    }

    const details = integrationProvider.externalUrl
      ? await ioRedis.get(`external:${body.state}`)
      : undefined;

    if (details) {
      await ioRedis.del(`external:${body.state}`);
    }

    const refresh = await ioRedis.get(`refresh:${body.state}`);
    if (refresh) {
      await ioRedis.del(`refresh:${body.state}`);
    }

    const onboarding = await ioRedis.get(`onboarding:${body.state}`);
    if (onboarding) {
      await ioRedis.del(`onboarding:${body.state}`);
    }

    const {
      error,
      accessToken,
      expiresIn,
      refreshToken,
      id,
      name,
      picture,
      username,
      additionalSettings,
      // eslint-disable-next-line no-async-promise-executor
    } = await new Promise<AuthTokenDetails>(async (res) => {
      try {
        const auth = await integrationProvider.authenticate(
          {
            code: body.code,
            codeVerifier: getCodeVerifier,
            refresh: body.refresh,
          },
          details ? JSON.parse(details) : undefined
        );

        if (typeof auth === 'string') {
          return res({
            error: auth,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        if (refresh && integrationProvider.reConnect) {
          console.log('reconnect');
          try {
            const newAuth = await integrationProvider.reConnect(
              auth.id,
              refresh,
              auth.accessToken
            );
            return res({ ...newAuth, refreshToken: body.refresh });
          } catch (err: any) {
            return res({
              error: err.message,
              accessToken: '',
              id: '',
              name: '',
              picture: '',
              username: '',
              additionalSettings: [],
            });
          }
        }

        return res(auth);
      } catch (err) {
        if (err instanceof NotEnoughScopes) {
          return res({
            error: err.message,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        return res({
          error: 'Authentication failed',
          accessToken: '',
          id: '',
          name: '',
          picture: '',
          username: '',
          additionalSettings: [],
        });
      }
    });

    if ((error || !id) && connectCharge) {
      await this._integrationService.refundApiUse(
        connectCharge,
        'Refund: the channel was not connected'
      );
    }

    if (error) {
      throw new NotEnoughScopes(error);
    }

    if (!id) {
      throw new NotEnoughScopes('Invalid API key');
    }

    if (refresh && String(id) !== String(refresh)) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    let validName = name;
    if (!validName) {
      if (username) {
        validName = username.split('.')[0] ?? username;
      } else {
        validName = `Channel_${String(id).slice(0, 8)}`;
      }
    }

    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      org.isTrailing &&
      (await this._integrationService.checkPreviousConnections(
        org.id,
        String(id)
      ))
    ) {
      throw new HttpException('', 412);
    }

    const createUpdate =
      await this._integrationService.createOrUpdateIntegration(
        additionalSettings,
        !!integrationProvider.oneTimeToken,
        org.id,
        validName.trim(),
        picture,
        'social',
        String(id),
        integration,
        accessToken,
        refreshToken,
        expiresIn,
        username,
        refresh ? false : integrationProvider.isBetweenSteps,
        body.refresh,
        +body.timezone,
        details
          ? AuthService.fixedEncryption(details)
          : integrationProvider.customFields
          ? AuthService.fixedEncryption(
              Buffer.from(body.code, 'base64').toString()
            )
          : integrationProvider.isChromeExtension
          ? AuthService.fixedEncryption(
              Buffer.from(body.code, 'base64').toString()
            )
          : undefined
      );

    // The state has done its job. A two-step provider still needs it for
    // choosing the page, but only for this one channel; anything else is done.
    if (integrationProvider.isBetweenSteps && !refresh) {
      await ioRedis.set(
        connectStateKey(body.state),
        serializeConnectState({ ...stateRecord, integrationId: createUpdate.id }),
        'EX',
        CONNECT_STATE_TTL_SECONDS
      );
    } else {
      await ioRedis.del(connectStateKey(body.state));
    }
    if (integrationProvider.customFields) {
      await ioRedis.del(`login:${body.state}`);
    }

    this._refreshIntegrationService
      .startRefreshWorkflow(org.id, createUpdate.id, integrationProvider)
      .catch((err) => {
        console.log(err);
      });

    // Fetch pages if this is a two-step provider and not a refresh
    let pages: any[] = [];
    if (integrationProvider.isBetweenSteps && !refresh) {
      try {
        // Check which method the provider uses (pages or companies)
        const fetchMethod =
          'pages' in integrationProvider
            ? 'pages'
            : 'companies' in integrationProvider
            ? 'companies'
            : null;

        if (fetchMethod) {
          // @ts-ignore - dynamic method call
          pages = await integrationProvider[fetchMethod](accessToken);
        }
      } catch (err) {
        console.log('Failed to fetch pages:', err);
      }
    }

    const webhookUrl = await ioRedis.get(`webhookUrl:${body.state}`);
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            params: AuthService.signJWT({
              apiKey: org.apiKey,
            }),
          }),
        });
      } catch (err) {}

      await ioRedis.del(`webhookUrl:${body.state}`);
    }

    const returnURL = await ioRedis.get(`redirect:${body.state}`);
    if (returnURL) {
      await ioRedis.del(`redirect:${body.state}`);
    }

    const extensionToken = integrationProvider.isChromeExtension
      ? AuthService.signJWT({
          integrationId: createUpdate.id,
          organizationId: org.id,
          internalId: String(id),
          provider: integration,
        })
      : undefined;

    // Never leak stored credentials (signed/encrypted secrets) back to the
    // caller. These columns hold the integration access token, refresh token
    // and encrypted custom instance details and must stay server-side.
    const {
      token: _token,
      refreshToken: _refreshToken,
      customInstanceDetails: _customInstanceDetails,
      ...safeIntegration
    } = createUpdate as any;

    return {
      ...safeIntegration,
      onboarding: onboarding === 'true',
      pages,
      ...(returnURL ? { returnURL } : {}),
      ...(extensionToken ? { extensionToken } : {}),
    };
  }

  @Post('/public/provider/:id/connect')
  async saveProviderPage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: any
  ) {
    if (!body.state) {
      throw new Error('Invalid state');
    }

    const stateRecord = parseConnectState(
      await ioRedis.get(connectStateKey(body.state))
    );
    if (!stateRecord) {
      throw new Error('Organization not found');
    }

    // Only the channel this state just connected. A record without one is
    // either still unused or was written before records said which channel,
    // and only the latter is let through.
    if (
      stateRecord.integrationId
        ? stateRecord.integrationId !== id
        : stateRecord.via !== 'legacy'
    ) {
      throw new HttpException('Integration not found', 404);
    }

    await this.assertConnectAllowed(req, stateRecord);

    const org = await this._organizationService.getOrgById(stateRecord.orgId);

    const saved = await this._integrationService.saveProviderPage(
      org.id,
      id,
      body
    );

    await ioRedis.del(connectStateKey(body.state));

    return saved;
  }

  @Post('/extension-refresh')
  async extensionRefreshCookies(
    @Body() body: { jwt: string; cookies: string }
  ) {
    let payload: any;
    try {
      payload = AuthService.verifyJWT(body.jwt);
    } catch {
      throw new HttpException('Invalid token', 401);
    }

    const { integrationId, organizationId, internalId, provider } = payload;
    if (!integrationId || !organizationId || !internalId || !provider) {
      throw new HttpException('Invalid token payload', 400);
    }

    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration || integration.internalId !== internalId) {
      throw new HttpException('Integration not found', 404);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(provider);
    if (!integrationProvider?.isChromeExtension) {
      throw new HttpException('Not a Chrome extension integration', 400);
    }

    const authResult = await integrationProvider.authenticate({
      code: body.cookies,
      codeVerifier: '',
    });

    if (typeof authResult === 'string') {
      throw new HttpException(authResult, 400);
    }

    if (String(authResult.id) !== String(integration.internalId)) {
      await this._integrationService.refreshNeeded(
        organizationId,
        integrationId
      );
      return { success: false, reason: 'account_mismatch' };
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      false,
      organizationId,
      integration.name,
      undefined,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      authResult.accessToken,
      '',
      authResult.expiresIn,
      undefined,
      false,
      undefined,
      undefined,
      AuthService.signJWT(
        JSON.parse(Buffer.from(body.cookies, 'base64').toString())
      )
    );

    return { success: true };
  }
}
