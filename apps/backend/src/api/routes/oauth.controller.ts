import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import { AuthorizeOAuthQueryDto, ApproveOAuthDto } from '@gitroom/nestjs-libraries/dtos/oauth/authorize-oauth.dto';
import { TokenExchangeDto } from '@gitroom/nestjs-libraries/dtos/oauth/token-exchange.dto';
import { RegisterClientDto } from '@gitroom/nestjs-libraries/dtos/oauth/register-client.dto';

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthController {
  constructor(private _oauthService: OAuthService) {}

  @Get('/authorize')
  async authorize(@Query() query: AuthorizeOAuthQueryDto) {
    const { app, redirectUri } =
      await this._oauthService.checkAuthorizationRequest(query.client_id, {
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method,
      });

    return {
      app: {
        name: app.name,
        description: app.description,
        picture: app.picture,
        clientId: app.clientId,
        redirectUrl: redirectUri,
        // The consent screen names the host the user is sent back to, since a
        // self-registered client chooses its own name.
        redirectHost: new URL(redirectUri).host,
        isPublic: app.isPublic,
      },
      state: query.state,
    };
  }

  @Post('/register')
  @Header('Cache-Control', 'no-store')
  register(@Body() body: RegisterClientDto) {
    return this._oauthService.registerClient(body);
  }

  @Post('/token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async token(@Body() body: TokenExchangeDto) {
    if (body.grant_type !== 'authorization_code') {
      throw new HttpException(
        { error: 'unsupported_grant_type' },
        HttpStatus.BAD_REQUEST
      );
    }

    return this._oauthService.exchangeCodeForToken(
      body.code,
      body.client_id,
      body.client_secret,
      { codeVerifier: body.code_verifier, redirectUri: body.redirect_uri }
    );
  }
}

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthAuthorizedController {
  constructor(
    private _oauthService: OAuthService,
    private _organizationService: OrganizationService
  ) {}

  @Post('/authorize')
  async approveOrDeny(
    @Body() body: ApproveOAuthDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    const { app, redirectUri } =
      await this._oauthService.checkAuthorizationRequest(body.client_id, {
        redirectUri: body.redirect_uri,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
      });

    if (body.action === 'deny') {
      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set('error', 'access_denied');
      if (body.state) {
        redirectUrl.searchParams.set('state', body.state);
      }
      return { redirect: redirectUrl.toString() };
    }

    // The workspace the user picked on the consent screen, if they belong to
    // more than one; otherwise the one they have open.
    let organizationId = org.id;
    if (body.organization_id && body.organization_id !== org.id) {
      const member = (
        await this._organizationService.getOrgsByUserId(user.id)
      ).find((o) => o.id === body.organization_id && !o.users[0]?.disabled);
      if (!member) {
        throw new HttpException('Workspace not found', HttpStatus.FORBIDDEN);
      }
      organizationId = member.id;
    }

    const code = await this._oauthService.createAuthorizationCode(
      app.id,
      user.id,
      organizationId,
      { codeChallenge: body.code_challenge, redirectUri }
    );

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state);
    }
    return { redirect: redirectUrl.toString() };
  }
}
