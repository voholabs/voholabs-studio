import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { CreateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';
import { UpdateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/update-oauth-app.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { RegisterClientDto } from '@gitroom/nestjs-libraries/dtos/oauth/register-client.dto';
import {
  isAllowedRedirectUri,
  matchRedirectUri,
  verifyPkce,
} from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.client';

const oauthError = (
  error: string,
  status: HttpStatus,
  error_description?: string
) =>
  new HttpException(
    { error, ...(error_description ? { error_description } : {}) },
    status
  );

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

    const clientId = 'pca_' + makeId(32);
    const clientSecret = 'pcs_' + makeId(48);
    const encryptedSecret = AuthService.fixedEncryption(clientSecret);

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

    const newSecret = 'pcs_' + makeId(48);
    const encrypted = AuthService.fixedEncryption(newSecret);
    await this._oauthRepository.updateClientSecret(orgId, encrypted);
    return { clientSecret: newSecret };
  }

  // Dynamic client registration (RFC 7591): an AI assistant such as Claude or
  // ChatGPT registers itself as a public client before sending the user to the
  // consent screen. It belongs to no workspace until a user approves it.
  async registerClient(dto: RegisterClientDto) {
    const invalid = dto.redirect_uris.find((uri) => !isAllowedRedirectUri(uri));
    if (invalid) {
      throw oauthError(
        'invalid_redirect_uri',
        HttpStatus.BAD_REQUEST,
        'Redirect URIs must use https, or http on a loopback address'
      );
    }

    const clientId = 'pca_' + makeId(32);
    const name = (dto.client_name || '').trim().slice(0, 100) || 'AI assistant';
    const app = await this._oauthRepository.createPublicApp({
      name,
      redirectUris: dto.redirect_uris,
      clientId,
      // Never used: a public client authenticates with PKCE. The column is
      // required, so it holds a random value no one knows.
      clientSecret: AuthService.fixedEncryption('pcs_' + makeId(48)),
    });

    return {
      client_id: app.clientId,
      client_id_issued_at: Math.floor(app.createdAt.getTime() / 1000),
      client_name: app.name,
      redirect_uris: app.redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
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

  async createAuthorizationCode(
    oauthAppId: string,
    userId: string,
    organizationId: string,
    pkce: { codeChallenge?: string; redirectUri?: string } = {}
  ) {
    const code = makeId(32);
    const encryptedCode = AuthService.fixedEncryption(code);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this._oauthRepository.createAuthorization({
      oauthAppId,
      userId,
      organizationId,
      authorizationCode: encryptedCode,
      codeExpiresAt,
      codeChallenge: pkce.codeChallenge,
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
      !app.isPublic &&
      (!clientSecret ||
        app.clientSecret !== AuthService.fixedEncryption(clientSecret))
    ) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    const encryptedCode = AuthService.fixedEncryption(code);
    const auth = await this._oauthRepository.findByCode(encryptedCode);
    if (!auth || auth.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (!auth.codeExpiresAt || new Date() > auth.codeExpiresAt) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'Code has expired' },
        HttpStatus.BAD_REQUEST
      );
    }

    // PKCE: a code issued with a challenge is only exchanged with its verifier,
    // and a public client's code always carries one (checkAuthorizationRequest).
    if (auth.codeChallenge || app.isPublic) {
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

    const token = 'pos_' + makeId(40);
    const encryptedToken = AuthService.fixedEncryption(token);
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
      return { access_token: token, token_type: 'bearer' };
    }

    return {
      id: organizationId,
      cus: paymentId,
      access_token: token,
      token_type: 'bearer',
    };
  }

  async getOrgByOAuthToken(token: string) {
    const encrypted = AuthService.fixedEncryption(token);
    return this._oauthRepository.findByAccessToken(encrypted);
  }

  async getApprovedApps(userId: string) {
    return this._oauthRepository.getApprovedApps(userId);
  }

  async revokeApp(userId: string, authId: string) {
    await this._oauthRepository.revokeAuthorization(userId, authId);
    return { success: true };
  }
}
