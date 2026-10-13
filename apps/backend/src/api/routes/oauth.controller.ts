import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import {
  AuthorizeOAuthQueryDto,
  ApproveOAuthDto,
  AuthorizeSelfHostedDto,
} from '@gitroom/nestjs-libraries/dtos/oauth/authorize-oauth.dto';
import { TokenExchangeDto } from '@gitroom/nestjs-libraries/dtos/oauth/token-exchange.dto';
import { RegisterClientDto } from '@gitroom/nestjs-libraries/dtos/oauth/register-client.dto';
import { redirectLabel } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.client';
import { extractBasicCredentials } from '@gitroom/nestjs-libraries/chat/oauth-types';
import { McpRelayService } from '@gitroom/nestjs-libraries/chat/mcp.relay.service';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthController {
  constructor(
    private _oauthService: OAuthService,
    private _mcpRelayService: McpRelayService
  ) {}

  @Get('/authorize')
  async authorize(@Query() query: AuthorizeOAuthQueryDto) {
    const { app, redirectUri } =
      await this._oauthService.checkAuthorizationRequest(query.client_id, {
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method,
      });

    const selfHosted = this._oauthService.allowsSelfHosted(
      app,
      query.resource
    );

    return {
      app: {
        name: app.name,
        description: app.description,
        picture: app.picture,
        clientId: app.clientId,
        redirectUrl: redirectUri,
        // The consent screen names the host the user is sent back to, since a
        // self-registered client chooses its own name.
        redirectHost: redirectLabel(redirectUri),
        isPublic: app.isPublic,
      },
      state: query.state,
      selfHosted,
      selfHostedEmail:
        selfHosted && this._oauthService.selfHostedRequiresEmail(app),
    };
  }

  // Dynamic Client Registration (RFC 7591), used by MCP clients like Claude,
  // ChatGPT, Cursor and Claude Code
  @Post('/register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  register(@Body() body: RegisterClientDto) {
    return this._oauthService.registerClient(body);
  }

  // Connects the MCP client to the person's own self-hosted instance instead
  // of a workspace here. Public (the person may have no account here) and
  // capped per client, since every attempt sends requests to the instance
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 30, ttl: 3600000 } })
  @Post('/authorize/self-hosted')
  async authorizeSelfHosted(@Body() body: AuthorizeSelfHostedDto) {
    const { app, redirectUri } =
      await this._oauthService.checkAuthorizationRequest(body.client_id, {
        redirectUri: body.redirect_uri,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
      });

    const email = body.email?.trim();
    this._oauthService.validateSelfHostedRequest(app, {
      resource: body.resource,
      email,
    });

    const instance = await this._mcpRelayService.connect(
      body.instance_url,
      body.api_key
    );

    const code = await this._oauthService.createSelfHostedAuthorizationCode(
      app.id,
      { ...instance, email },
      app.isPublic
        ? {
            codeChallenge: body.code_challenge,
            codeChallengeMethod: body.code_challenge_method,
            redirectUri,
          }
        : {}
    );

    // Same redirect as an approved workspace authorization
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state);
    }
    return { redirect: redirectUrl.toString() };
  }

  @Post('/token')
  // RFC 6749 §5.1: successful token responses are 200; strict clients reject
  // Nest's default 201
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async token(
    @Body() body: TokenExchangeDto,
    @Headers('authorization') authorization?: string
  ) {
    if (body.grant_type !== 'authorization_code') {
      throw new HttpException(
        { error: 'unsupported_grant_type' },
        HttpStatus.BAD_REQUEST
      );
    }

    // client_secret_basic puts the credentials in the Authorization header,
    // client_secret_post and public clients put them in the body
    const basic = extractBasicCredentials(authorization);
    const clientId = basic?.clientId || body.client_id;
    if (!clientId) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    return this._oauthService.exchangeCodeForToken(
      body.code,
      clientId,
      basic?.clientSecret || body.client_secret,
      { codeVerifier: body.code_verifier, redirectUri: body.redirect_uri }
    );
  }

  @Get('/userinfo')
  @Header('Cache-Control', 'no-store')
  async userinfo(@Headers('authorization') authorization?: string) {
    return this._oauthService.getUserInfo(authorization);
  }

  @Post('/userinfo')
  @Header('Cache-Control', 'no-store')
  async userinfoPost(@Headers('authorization') authorization?: string) {
    return this._oauthService.getUserInfo(authorization);
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
      {
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge
          ? body.code_challenge_method
          : undefined,
        redirectUri,
      }
    );

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state);
    }
    return { redirect: redirectUrl.toString() };
  }
}
