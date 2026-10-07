import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

@AuthProvider({ provider: 'GITHUB' })
export class GithubProvider extends AuthProviderAbstract {
  override readonly requiresState = true;

  generateLink(_query?: unknown, state?: string): string {
    return `https://github.com/login/oauth/authorize?client_id=${
      process.env.GITHUB_CLIENT_ID
    }&scope=user:email&redirect_uri=${encodeURIComponent(
      `${process.env.FRONTEND_URL}/settings`
    )}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
  }

  async getToken(code: string, _redirectUri?: string): Promise<string> {
    const { access_token } = await (
      await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${process.env.FRONTEND_URL}/settings`,
        }),
      })
    ).json();

    return access_token;
  }

  // Asks GitHub whether the token was issued to this OAuth app, and to whom.
  // A token issued to any other app would otherwise read the same profile.
  private async checkTokenIsOurs(access_token: string) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret || !access_token) {
      throw new Error('Invalid provider token');
    }

    const response = await fetch(
      `https://api.github.com/applications/${encodeURIComponent(
        clientId
      )}/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`
          ).toString('base64')}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Postiz',
        },
        body: JSON.stringify({ access_token }),
      }
    );

    if (response.status !== 200) {
      throw new Error('Invalid provider token');
    }

    const data = await response.json();
    if (data?.app?.client_id !== clientId || !data?.user?.id) {
      throw new Error('Invalid provider token');
    }

    return String(data.user.id);
  }

  async getUser(access_token: string): Promise<{ email: string; id: string }> {
    const id = await this.checkTokenIsOurs(access_token);

    const emails = await (
      await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `token ${access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Postiz',
        },
      })
    ).json();

    // The primary address, and only once GitHub has verified it.
    const primary = Array.isArray(emails)
      ? emails.find((e: any) => e?.primary && e?.verified && e?.email)
      : undefined;

    if (!primary) {
      throw new Error('Your GitHub account has no verified primary email');
    }

    return {
      email: primary.email,
      id,
    };
  }
}
