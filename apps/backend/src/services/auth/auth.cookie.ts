import { CookieOptions, Response } from 'express';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { SESSION_TTL_SECONDS } from '@gitroom/helpers/auth/session.token';

// The one place the cookie attributes live, so every route that signs somebody
// in or out writes exactly the same cookie.
export const authCookieBaseOptions = (): CookieOptions => ({
  domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
  ...(!process.env.NOT_SECURED
    ? {
        secure: true,
        httpOnly: true,
        sameSite: 'none',
      }
    : {}),
});

// The cookie lasts as long as the session inside it.
export const setAuthCookie = (response: Response, jwt: string) => {
  response.cookie('auth', jwt, {
    ...authCookieBaseOptions(),
    expires: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });

  if (process.env.NOT_SECURED) {
    response.header('auth', jwt);
  }
};

export const clearAuthCookie = (response: Response) => {
  response.cookie('auth', '', {
    ...authCookieBaseOptions(),
    expires: new Date(0),
    maxAge: -1,
  });
};
