import { google } from 'googleapis';
import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

const defaultRedirect = () =>
  `${process.env.FRONTEND_URL}/integrations/social/youtube`;

const makeClient = (redirectUri: string) =>
  new google.auth.OAuth2({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri,
  });

@AuthProvider({ provider: 'GOOGLE' })
export class GoogleProvider extends AuthProviderAbstract {
  override readonly requiresState = true;

  // The state starts with `login` on purpose: the frontend tells a sign-in
  // callback apart from a YouTube channel connection (same redirect URI) by
  // `state=login` in the URL (apps/frontend/src/proxy.ts).
  generateLink(query?: { redirect_uri?: string }, state?: string) {
    const redirectUri = query?.redirect_uri || defaultRedirect();
    return makeClient(redirectUri).generateAuthUrl({
      access_type: 'online',
      prompt: 'consent',
      state: state || 'login',
      redirect_uri: redirectUri,
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
  }

  async getToken(code: string, redirectUri?: string) {
    const client = makeClient(redirectUri || defaultRedirect());
    const { tokens } = await client.getToken(code);
    return tokens.access_token!;
  }

  async getUser(providerToken: string) {
    const client = makeClient(defaultRedirect());

    // The access token has to have been issued to this app. A token Google
    // issued to any other app would otherwise read the same userinfo.
    const info = await client.getTokenInfo(providerToken).catch(() => null);
    if (
      !info ||
      !process.env.YOUTUBE_CLIENT_ID ||
      info.aud !== process.env.YOUTUBE_CLIENT_ID
    ) {
      throw new Error('Invalid provider token');
    }

    client.setCredentials({ access_token: providerToken });
    const { data } = await google
      .oauth2({ version: 'v2', auth: client })
      .userinfo.get();

    return {
      id: data.id!,
      email: data.email!,
    };
  }
}
