import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { CreateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';
import { UpdateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/update-oauth-app.dto';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  AuthService,
  encryptSecret,
  lookupCandidates,
  lookupHash,
} from '@gitroom/helpers/auth/auth.service';
import { RegisterClientDto } from '@gitroom/nestjs-libraries/dtos/oauth/register-client.dto';
import {
  isAllowedRedirectUri,
  matchRedirectUri,
  safeEqual,
  verifyPkce,
} from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.client';
import { extractBearerToken } from '@gitroom/nestjs-libraries/chat/oauth-types';
import { OAuthApp } from '@prisma/client';
import type { SelfHostedInstance } from '@gitroom/nestjs-libraries/chat/mcp.relay.service';

const oauthError = (
  error: string,
  status: HttpStatus,
  error_description?: string
) =>
  new HttpException(
    { error, ...(error_description ? { error_description } : {}) },
    status
  );

const openAiOAuthClientId = () => process.env.OPENAI_OAUTH_CLIENT_ID?.trim();

const enableOidcEmailClaims = () => Boolean(openAiOAuthClientId());

// The static app HubSpot agents connect with (created under Settings >
// Developers). HubSpot's MCP connector sends no client secret and requires a
// refresh token, see isPublicClient and refreshFields
const hubspotOAuthClientId = () =>
  process.env.HUBSPOT_OAUTH_CLIENT_ID?.trim();

// Postiz access tokens never expire, but HubSpot wants an expires_in: ten
// years (a hundred would not fit in a 32-bit integer)
const hubspotTokenExpiresIn = 10 * 365 * 24 * 60 * 60;

// The HubSpot app itself (HubSpot project > app > Auth tab), not the Postiz
// app above: its redirect URL finishes the install, see completeHubspotInstall
const hubspotAppClientId = () => process.env.HUBSPOT_APP_CLIENT_ID?.trim();
const hubspotAppClientSecret = () =>
  process.env.HUBSPOT_APP_CLIENT_SECRET?.trim();
const hubspotInstallRedirectUri = () =>
  `${process.env.NEXT_PUBLIC_BACKEND_URL}/oauth/hubspot/callback`;

// The link that installs the HubSpot app in a HubSpot account (listed in
// Settings > Integrations), undefined when the install can't be completed here
export const hubspotInstallUrl = () => {
  const clientId = hubspotAppClientId();
  if (!clientId || !hubspotAppClientSecret()) {
    return undefined;
  }

  const url = new URL('https://app.hubspot.com/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', hubspotInstallRedirectUri());
  url.searchParams.set('scope', 'oauth');
  return url.toString();
};

// Relaying an MCP connection to a self-hosted instance is off unless
// MCP_SELF_HOSTED_RELAY=true
export const selfHostedRelayEnabled = () =>
  process.env.MCP_SELF_HOSTED_RELAY === 'true';

// Verified-domain match: exact host or a subdomain of it (the leading dot
// means evilclaude.ai and claude.ai.evil.com are both rejected)
const isVerifiedHost = (host: string, verifiedDomains: string[]) =>
  verifiedDomains.some(
    (domain) => host === domain || host.endsWith('.' + domain)
  );

type EmailClaimsApp = Pick<OAuthApp, 'clientId' | 'isPublic' | 'redirectUris'>;

@Injectable()
export class OAuthService {
  constructor(private _oauthRepository: OAuthRepository) {}

  async getApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) return false;
    const { clientSecret, ...rest } = app;
    return rest;
  }

  async createApp(orgId: string, dto: CreateOAuthAppDto) {
    const existing = await this._oauthRepository.getAppByOrgId(orgId);
    if (existing) {
      throw new HttpException(
        'You can only have one OAuth application per organization',
        HttpStatus.BAD_REQUEST
      );
    }

    const clientId = 'pca_' + makeSecureId(32);
    const clientSecret = 'pcs_' + makeSecureId(48);
    const encryptedSecret = lookupHash(clientSecret);

    const app = await this._oauthRepository.createApp(orgId, {
      name: dto.name,
      description: dto.description,
      pictureId: dto.pictureId,
      redirectUrl: dto.redirectUrl,
      clientId,
      clientSecret: encryptedSecret,
    });

    return { ...app, clientSecret };
  }

  async updateApp(orgId: string, dto: UpdateOAuthAppDto) {
    return this._oauthRepository.updateApp(orgId, {
      ...(dto.name && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.pictureId !== undefined && { pictureId: dto.pictureId }),
      ...(dto.redirectUrl && { redirectUrl: dto.redirectUrl }),
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }
    await this._oauthRepository.revokeAllForApp(app.id);
    await this._oauthRepository.deleteApp(orgId);
    return { success: true };
  }

  async rotateSecret(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }

    const newSecret = 'pcs_' + makeSecureId(48);
    const encrypted = lookupHash(newSecret);
    await this._oauthRepository.updateClientSecret(orgId, encrypted);
    return { clientSecret: newSecret };
  }

  // Dynamic client registration (RFC 7591): an AI assistant such as Claude,
  // ChatGPT, Cursor or Claude Code registers itself as a public client before
  // sending the user to the consent screen. It belongs to no workspace until a
  // user approves it. Every self-registered client authenticates with PKCE,
  // whatever token_endpoint_auth_method it asked for; the response tells it so.
  async registerClient(dto: RegisterClientDto) {
    const redirectUris = dto.redirect_uris.map((uri) => uri.trim());
    const invalid = redirectUris.find((uri) => !isAllowedRedirectUri(uri));
    if (invalid) {
      throw oauthError(
        'invalid_redirect_uri',
        HttpStatus.BAD_REQUEST,
        'Redirect URIs must use https, http on a loopback address, or an app link scheme'
      );
    }

    if (
      dto.grant_types?.length &&
      !dto.grant_types.includes('authorization_code')
    ) {
      throw oauthError(
        'invalid_client_metadata',
        HttpStatus.BAD_REQUEST,
        'Only the authorization_code grant type is supported'
      );
    }

    // Registration happens before consent, so abandoned flows leave clients
    // no one ever approved; prune the ones older than 30 days
    Promise.resolve()
      .then(() =>
        this._oauthRepository.deleteStalePublicApps(
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        )
      )
      .catch(() => {});

    const clientId = 'pca_' + makeSecureId(32);
    const name = (dto.client_name || '').trim().slice(0, 100) || 'AI assistant';
    const app = await this._oauthRepository.createPublicApp({
      name,
      redirectUris,
      clientId,
      // Never used: a public client authenticates with PKCE. The column is
      // required, so it holds a random value no one knows.
      clientSecret: lookupHash('pcs_' + makeSecureId(48)),
    });

    return {
      client_id: app.clientId,
      client_id_issued_at: Math.floor(app.createdAt.getTime() / 1000),
      client_name: app.name,
      redirect_uris: app.redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp:read mcp:write',
    };
  }

  // Checks a request to the consent screen and settles where the user is sent
  // back to. An app a workspace created keeps its single redirect URL; a
  // self-registered client must name one of its own URIs and use PKCE.
  async checkAuthorizationRequest(
    clientId: string,
    request: {
      redirectUri?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
    }
  ) {
    const app = await this.validateAuthorizationRequest(clientId);

    if (!app.isPublic) {
      if (request.redirectUri && request.redirectUri !== app.redirectUrl) {
        throw new HttpException('Invalid redirect_uri', HttpStatus.BAD_REQUEST);
      }
      // A public static app (HubSpot) has no secret, so it must use PKCE
      if (
        this.isPublicClient(app) &&
        (!request.codeChallenge ||
          (request.codeChallengeMethod &&
            request.codeChallengeMethod !== 'S256'))
      ) {
        throw new HttpException(
          'This app must use PKCE with code_challenge_method=S256',
          HttpStatus.BAD_REQUEST
        );
      }
      return { app, redirectUri: app.redirectUrl };
    }

    const redirectUri = request.redirectUri
      ? matchRedirectUri(app.redirectUris, request.redirectUri)
      : app.redirectUris.length === 1
      ? app.redirectUris[0]
      : null;
    if (!redirectUri) {
      throw new HttpException('Invalid redirect_uri', HttpStatus.BAD_REQUEST);
    }

    if (!request.codeChallenge || request.codeChallengeMethod !== 'S256') {
      throw new HttpException(
        'This app must use PKCE with code_challenge_method=S256',
        HttpStatus.BAD_REQUEST
      );
    }

    return { app, redirectUri };
  }

  async validateAuthorizationRequest(clientId: string) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException('Invalid client_id', HttpStatus.BAD_REQUEST);
    }
    return app;
  }

  // Domains whose web callbacks may receive email claims, from the
  // DCR_VERIFIED_DOMAINS env (comma separated)
  private verifiedDomainList() {
    return (process.env.DCR_VERIFIED_DOMAINS || '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
  }

  // Email claims (openid/email scope + userinfo) go to the static ChatGPT app
  // and to self-registered clients whose web callbacks all live on a verified
  // domain (DCR_VERIFIED_DOMAINS). Everything else only gets the mcp scopes
  private allowsEmailClaims(app: EmailClaimsApp) {
    if (!enableOidcEmailClaims()) {
      return false;
    }
    if (app.clientId === openAiOAuthClientId()) {
      return true;
    }
    if (!app.isPublic) {
      return false;
    }

    const verifiedDomains = this.verifiedDomainList();
    if (!verifiedDomains.length) {
      return false;
    }

    const webHosts: string[] = [];
    for (const uri of app.redirectUris || []) {
      try {
        const parsed = new URL(uri);
        if (parsed.protocol === 'https:') {
          webHosts.push(parsed.hostname.toLowerCase());
        }
      } catch {
        return false;
      }
    }

    return (
      webHosts.length > 0 &&
      webHosts.every((host) => isVerifiedHost(host, verifiedDomains))
    );
  }

  private grantedScope(app: EmailClaimsApp) {
    return [
      ...(this.allowsEmailClaims(app) ? ['openid', 'email'] : []),
      'mcp:read',
      'mcp:write',
    ].join(' ');
  }

  // Only MCP connections can be relayed to a self-hosted instance:
  // self-registered clients (registration is only advertised to MCP clients),
  // the ChatGPT app, or a client asking for one of the /mcp-oauth resources
  // (RFC 8707). Apps that use OAuth for the public API never get the option,
  // a relayed token doesn't work there
  allowsSelfHosted(
    app: Pick<OAuthApp, 'clientId' | 'isPublic'>,
    resource?: string
  ) {
    if (!selfHostedRelayEnabled()) {
      return false;
    }
    if (app.isPublic || app.clientId === openAiOAuthClientId()) {
      return true;
    }
    try {
      return (
        !!resource &&
        /^(\/api)?\/mcp-oauth/.test(new URL(resource).pathname)
      );
    } catch {
      return false;
    }
  }

  // The ChatGPT app reads the email from userinfo; a self-hosted connection
  // has no cloud user to take it from, so the consent screen asks for one
  selfHostedRequiresEmail(app: Pick<OAuthApp, 'clientId'>) {
    return enableOidcEmailClaims() && app.clientId === openAiOAuthClientId();
  }

  // On top of checkAuthorizationRequest, for a self-hosted connection
  validateSelfHostedRequest(
    app: Pick<OAuthApp, 'clientId' | 'isPublic'>,
    options: { resource?: string; email?: string }
  ) {
    if (!this.allowsSelfHosted(app, options.resource)) {
      throw new HttpException(
        'This application can not connect to a self-hosted instance',
        HttpStatus.BAD_REQUEST
      );
    }

    if (!options.email && this.selfHostedRequiresEmail(app)) {
      throw new HttpException(
        'Enter your email address',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  // Clients that authenticate with PKCE instead of a client secret:
  // self-registered clients (isPublic), and HubSpot, whose MCP connector only
  // takes a client id
  private isPublicClient(app: Pick<OAuthApp, 'clientId' | 'isPublic'>) {
    return app.isPublic || app.clientId === hubspotOAuthClientId();
  }

  // What an authorization code is bound to: a self-registered client's PKCE
  // challenge and redirect_uri, a public static app's PKCE challenge only
  // (static apps always redirect to their stored redirectUrl). Other static
  // apps keep the lenient flow and bind nothing
  pkceBinding(
    app: Pick<OAuthApp, 'clientId' | 'isPublic'>,
    request: {
      codeChallenge?: string;
      codeChallengeMethod?: string;
      redirectUri?: string;
    }
  ) {
    if (app.isPublic) {
      return request;
    }
    if (this.isPublicClient(app)) {
      return {
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: request.codeChallengeMethod,
      };
    }
    return {};
  }

  async createAuthorizationCode(
    oauthAppId: string,
    userId: string,
    organizationId: string,
    pkce: {
      codeChallenge?: string;
      codeChallengeMethod?: string;
      redirectUri?: string;
    } = {}
  ) {
    const code = makeSecureId(32);
    const encryptedCode = lookupHash(code);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this._oauthRepository.createAuthorization({
      oauthAppId,
      userId,
      organizationId,
      authorizationCode: encryptedCode,
      codeExpiresAt,
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: pkce.codeChallengeMethod,
      redirectUri: pkce.redirectUri,
    });

    return code;
  }

  async createSelfHostedAuthorizationCode(
    oauthAppId: string,
    instance: SelfHostedInstance & { email?: string },
    pkce: {
      codeChallenge?: string;
      codeChallengeMethod?: string;
      redirectUri?: string;
    } = {}
  ) {
    this._oauthRepository
      .deleteAbandonedSelfHostedAuthorizations(
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      )
      .catch(() => {});

    // The prefix sends the code to the self-hosted table at the token
    // endpoint (regular codes use the same alphabet, without an underscore)
    const code = 'psc_' + makeSecureId(32);

    await this._oauthRepository.createSelfHostedAuthorization({
      oauthAppId,
      mcpUrl: instance.mcpUrl,
      apiKey: encryptSecret(instance.apiKey),
      email: instance.email,
      authorizationCode: lookupHash(code),
      codeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: pkce.codeChallengeMethod,
      redirectUri: pkce.redirectUri,
    });

    return code;
  }

  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret?: string,
    proof: { codeVerifier?: string; redirectUri?: string } = {}
  ) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (
      !this.isPublicClient(app) &&
      (!clientSecret ||
        !app.clientSecret ||
        !lookupCandidates(clientSecret).some((candidate) =>
          safeEqual(app.clientSecret!, candidate)
        ))
    ) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (code.startsWith('psc_')) {
      return this.exchangeSelfHostedCodeForToken(app, code, proof);
    }

    const auth = await this._oauthRepository.findByCode(lookupCandidates(code));
    if (!auth || auth.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    this.verifyCodeGrant(app, auth, proof);

    const token = 'pos_' + makeSecureId(40);
    const encryptedToken = lookupHash(token);
    const {
      organizationId,
      organization: { paymentId },
    } = await this._oauthRepository.exchangeCodeForToken(
      auth.id,
      encryptedToken
    );

    // A public client is an AI assistant: it gets the token alone, not the
    // workspace's ids.
    if (app.isPublic) {
      return {
        access_token: token,
        token_type: 'bearer',
        scope: this.grantedScope(app),
      };
    }

    return {
      id: organizationId,
      cus: paymentId,
      access_token: token,
      token_type: 'bearer',
      scope: this.grantedScope(app),
      ...this.refreshFields(app, token),
    };
  }

  // Expiry, PKCE and redirect_uri checks of an authorization code, shared by
  // workspace and self-hosted authorizations
  private verifyCodeGrant(
    app: Pick<OAuthApp, 'clientId' | 'isPublic'>,
    auth: {
      codeExpiresAt: Date | null;
      codeChallenge: string | null;
      redirectUri: string | null;
    },
    proof: { codeVerifier?: string; redirectUri?: string }
  ) {
    if (!auth.codeExpiresAt || new Date() > auth.codeExpiresAt) {
      throw oauthError(
        'invalid_grant',
        HttpStatus.BAD_REQUEST,
        'Code has expired'
      );
    }

    // PKCE: a code issued with a challenge is only exchanged with its verifier,
    // and a public client's code always carries one (checkAuthorizationRequest).
    if (auth.codeChallenge || this.isPublicClient(app)) {
      if (
        !auth.codeChallenge ||
        !proof.codeVerifier ||
        !verifyPkce(proof.codeVerifier, auth.codeChallenge)
      ) {
        throw oauthError(
          'invalid_grant',
          HttpStatus.BAD_REQUEST,
          'PKCE verification failed'
        );
      }
    }

    if (
      auth.redirectUri &&
      proof.redirectUri &&
      proof.redirectUri !== auth.redirectUri
    ) {
      throw oauthError(
        'invalid_grant',
        HttpStatus.BAD_REQUEST,
        'redirect_uri does not match'
      );
    }
  }

  // A self-hosted connection has no organization (or payment) to return,
  // only the token
  private async exchangeSelfHostedCodeForToken(
    app: OAuthApp,
    code: string,
    proof: { codeVerifier?: string; redirectUri?: string }
  ) {
    const auth = selfHostedRelayEnabled()
      ? await this._oauthRepository.findSelfHostedByCode(
          lookupCandidates(code)
        )
      : null;
    if (!auth || auth.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    this.verifyCodeGrant(app, auth, proof);

    const token = 'psh_' + makeSecureId(40);
    await this._oauthRepository.exchangeSelfHostedCodeForToken(
      auth.id,
      lookupHash(token)
    );

    return {
      access_token: token,
      token_type: 'bearer',
      scope: this.grantedScope(app),
      ...this.refreshFields(app, token),
    };
  }

  // HubSpot refuses a token response without a refresh token. Postiz access
  // tokens never expire, so the refresh token is the access token itself:
  // refreshing hands it back unchanged, and it stops working exactly when the
  // access token does. No other client gets these fields
  private refreshFields(app: Pick<OAuthApp, 'clientId'>, token: string) {
    if (app.clientId !== hubspotOAuthClientId()) {
      return {};
    }

    return {
      refresh_token: token,
      expires_in: hubspotTokenExpiresIn,
    };
  }

  // The refresh_token grant, HubSpot only (see refreshFields): the refresh
  // token is looked up like an access token and handed back while it is valid
  async refreshAccessToken(clientId?: string, refreshToken?: string) {
    if (!clientId || clientId !== hubspotOAuthClientId()) {
      throw new HttpException(
        { error: 'unsupported_grant_type' },
        HttpStatus.BAD_REQUEST
      );
    }

    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!refreshToken) {
      throw new HttpException(
        { error: 'invalid_request', error_description: 'refresh_token is required' },
        HttpStatus.BAD_REQUEST
      );
    }

    // a self-hosted connection only works while the relay is on
    const candidates = lookupCandidates(refreshToken);
    const authorization = refreshToken.startsWith('psh_')
      ? selfHostedRelayEnabled()
        ? await this._oauthRepository.findSelfHostedByAccessToken(candidates)
        : null
      : await this._oauthRepository.findByAccessToken(candidates);
    if (!authorization || authorization.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    return {
      access_token: refreshToken,
      token_type: 'bearer',
      scope: this.grantedScope(app),
      ...this.refreshFields(app, refreshToken),
    };
  }

  // HubSpot only counts an install of the HubSpot app once its code is
  // exchanged. Postiz makes no HubSpot API calls, so the tokens are not kept
  async completeHubspotInstall(code: string) {
    const clientId = hubspotAppClientId();
    const clientSecret = hubspotAppClientSecret();
    if (!clientId || !clientSecret) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    let response: Response;
    try {
      response = await fetch('https://api.hubapi.com/oauth/v3/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: hubspotInstallRedirectUri(),
          code,
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      // timeout or network failure, fetch rejects instead of answering
      throw new HttpException(
        'Could not reach HubSpot to finish installing Voholabs Studio, please try again',
        HttpStatus.BAD_GATEWAY,
        { cause: err }
      );
    }

    if (!response.ok) {
      const value = await response.json().catch(() => null);
      throw new HttpException(
        `Could not finish installing Voholabs Studio in HubSpot${
          value?.message ? `: ${value.message}` : ''
        }`,
        HttpStatus.BAD_REQUEST
      );
    }

    await response.body?.cancel();
  }

  // null when the relay is off or the token is unknown or revoked
  async getSelfHostedByAccessToken(token: string) {
    if (!selfHostedRelayEnabled()) {
      return null;
    }

    const authorization =
      await this._oauthRepository.findSelfHostedByAccessToken(
        lookupCandidates(token)
      );
    if (!authorization) {
      return null;
    }

    return {
      id: authorization.id,
      mcpUrl: authorization.mcpUrl,
      apiKey: AuthService.fixedDecryption(authorization.apiKey),
    };
  }

  deleteSelfHostedAuthorization(id: string) {
    return this._oauthRepository.deleteSelfHostedAuthorization(id);
  }

  async getOrgByOAuthToken(token: string) {
    return this._oauthRepository.findByAccessToken(lookupCandidates(token));
  }

  async getUserInfo(authorization?: string) {
    if (!enableOidcEmailClaims()) {
      throw new HttpException(
        {
          error: 'not_found',
          error_description: 'OIDC email claims are not enabled',
        },
        HttpStatus.NOT_FOUND
      );
    }

    const token = extractBearerToken(authorization);
    if (!token) {
      throw new HttpException(
        { error: 'invalid_token', error_description: 'Bearer token required' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (token.startsWith('psh_')) {
      return this.getSelfHostedUserInfo(token);
    }

    const authorizationRecord = await this.getOrgByOAuthToken(token);
    if (!authorizationRecord) {
      throw new HttpException(
        {
          error: 'invalid_token',
          error_description: 'Token is invalid or revoked',
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!this.allowsEmailClaims(authorizationRecord.oauthApp)) {
      throw new HttpException(
        {
          error: 'insufficient_scope',
          error_description:
            'This OAuth client is not authorized to access email claims',
        },
        HttpStatus.FORBIDDEN
      );
    }

    const { user } = authorizationRecord;
    return {
      sub: user.id,
      email: user.email,
      email_verified: user.activated,
    };
  }

  // A self-hosted connection has no cloud user: the subject is the connection
  // and the email is the one typed on the consent screen, which nobody verified
  private async getSelfHostedUserInfo(token: string) {
    const selfHosted = selfHostedRelayEnabled()
      ? await this._oauthRepository.findSelfHostedUserInfo(
          lookupCandidates(token)
        )
      : null;
    if (!selfHosted) {
      throw new HttpException(
        {
          error: 'invalid_token',
          error_description: 'Token is invalid or revoked',
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (!this.allowsEmailClaims(selfHosted.oauthApp)) {
      throw new HttpException(
        {
          error: 'insufficient_scope',
          error_description:
            'This OAuth client is not authorized to access email claims',
        },
        HttpStatus.FORBIDDEN
      );
    }

    return {
      sub: selfHosted.id,
      ...(selfHosted.email
        ? { email: selfHosted.email, email_verified: false }
        : {}),
    };
  }

  async getApprovedApps(userId: string) {
    return this._oauthRepository.getApprovedApps(userId);
  }

  async revokeApp(userId: string, authId: string) {
    await this._oauthRepository.revokeAuthorization(userId, authId);
    return { success: true };
  }
}
