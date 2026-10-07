import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

@AuthProvider({ provider: 'GENERIC' })
export class OauthProvider extends AuthProviderAbstract {
  private getConfig() {
    const {
      POSTIZ_OAUTH_AUTH_URL,
      POSTIZ_OAUTH_CLIENT_ID,
      POSTIZ_OAUTH_CLIENT_SECRET,
      POSTIZ_OAUTH_TOKEN_URL,
      POSTIZ_OAUTH_USERINFO_URL,
      FRONTEND_URL,
    } = process.env;

    if (
      !POSTIZ_OAUTH_USERINFO_URL ||
      !POSTIZ_OAUTH_TOKEN_URL ||
      !POSTIZ_OAUTH_CLIENT_ID ||
      !POSTIZ_OAUTH_CLIENT_SECRET ||
      !POSTIZ_OAUTH_AUTH_URL ||
      !FRONTEND_URL
    ) {
      throw new Error('POSTIZ_OAUTH environment variables are not set');
    }

    return {
      authUrl: POSTIZ_OAUTH_AUTH_URL,
      clientId: POSTIZ_OAUTH_CLIENT_ID,
      clientSecret: POSTIZ_OAUTH_CLIENT_SECRET,
      tokenUrl: POSTIZ_OAUTH_TOKEN_URL,
      userInfoUrl: POSTIZ_OAUTH_USERINFO_URL,
      frontendUrl: FRONTEND_URL,
    };
  }

  override readonly requiresState = true;

  generateLink(_query?: unknown, state?: string): string {
    const { authUrl, clientId, frontendUrl } = this.getConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'openid profile email',
      response_type: 'code',
      redirect_uri: `${frontendUrl}/settings`,
      ...(state ? { state } : {}),
    });

    return `${authUrl}?${params.toString()}`;
  }

  async getToken(code: string, _redirectUri?: string): Promise<string> {
    const { tokenUrl, clientId, clientSecret, frontendUrl } = this.getConfig();
    const response = await fetch(`${tokenUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${frontendUrl}/settings`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${error}`);
    }

    const { access_token } = await response.json();
    return access_token;
  }

  // There is no portable way to ask an arbitrary OAuth server which client an
  // access token was issued to (token introspection is optional and often
  // closed), so no audience check is made here. What stops a token issued to
  // another app being used to sign in is AuthService: a provider token is only
  // accepted if it came out of our own code exchange in checkExists.
  async getUser(access_token: string): Promise<{ email: string; id: string }> {
    const { userInfoUrl } = this.getConfig();
    const response = await fetch(`${userInfoUrl}`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`User info request failed: ${error}`);
    }

    const { email, sub: id } = await response.json();
    return { email, id };
  }
}
