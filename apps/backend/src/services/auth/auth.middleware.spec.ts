process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.FRONTEND_URL = 'https://studio.example.com';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));

import { sign, verify } from 'jsonwebtoken';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import {
  LEGACY_CUTOFF_START,
  SESSION_TTL_SECONDS,
  checkSessionPayload,
  isRevokedSession,
  signActivationToken,
  signResetToken,
  signSessionToken,
} from '@gitroom/helpers/auth/session.token';

const secret = () => process.env.JWT_SECRET!;

const baseUser = () => ({
  id: 'user-1',
  email: 'a@b.co',
  activated: true,
  isSuperAdmin: false,
  password: 'hash',
  sessionsRevokedAt: null as Date | null,
  onboardedAt: new Date(),
  termsVersion: 'current',
});

const setup = (user = baseUser()) => {
  const users = { getUserById: jest.fn(async () => user) };
  const orgs = {
    getOrgsByUserId: jest.fn(async () => [
      { id: 'org-1', apiKey: 'k', users: [{ disabled: false, role: 'ADMIN' }] },
    ]),
    updateApiKey: jest.fn(),
    getUserOrg: jest.fn(),
  };
  const middleware = new AuthMiddleware(orgs as any, users as any);
  return { middleware, users };
};

const run = async (middleware: AuthMiddleware, token: string) => {
  const cookies: Array<{ name: string; value: string; options: any }> = [];
  const req: any = {
    method: 'GET',
    headers: {},
    cookies: { auth: token },
    originalUrl: '/user/self',
  };
  const res: any = {
    cookie: (name: string, value: string, options: any) =>
      cookies.push({ name, value, options }),
    header: jest.fn(),
  };
  const next = jest.fn();
  let error: unknown;
  try {
    await middleware.use(req, res, next);
  } catch (e) {
    error = e;
  }
  return { req, cookies, next, error };
};

// Terms and onboarding gates are not what is under test.
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/terms', () => ({
  needsTerms: () => false,
  termsOpenPaths: [],
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/onboarding', () => ({
  needsOnboarding: () => false,
  onboardingOpenPaths: [],
}));

describe('AuthMiddleware session tokens', () => {
  it('accepts a current session without re-issuing it', async () => {
    const { middleware } = setup();
    const { next, cookies, req, error } = await run(
      middleware,
      signSessionToken('user-1')
    );
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('user-1');
    expect(cookies).toHaveLength(0);
  });

  it('accepts an old-style session and swaps it for a current one', async () => {
    // Inside the carry-over period, whenever this test runs.
    jest.useFakeTimers({ now: Date.UTC(2026, 9, 20), advanceTimers: true });
    const { middleware } = setup();
    // The shape every session had before: the whole user row, no exp.
    const legacy = sign(
      { ...baseUser(), password: undefined, iat: LEGACY_CUTOFF_START - 86400 },
      secret()
    );
    const { next, cookies, error } = await run(middleware, legacy);
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('auth');
    const fresh = verify(cookies[0].value, secret()) as any;
    expect(fresh).toMatchObject({ id: 'user-1', type: 'session' });
    expect(fresh.exp - fresh.iat).toBe(SESSION_TTL_SECONDS);
    expect(Object.keys(fresh).sort()).toEqual(['exp', 'iat', 'id', 'type']);
    expect(cookies[0].options).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'none',
    });
    jest.useRealTimers();
  });

  it('refuses an exp-less session signed after the cutoff', async () => {
    const { middleware } = setup();
    const late = sign(
      { id: 'user-1', iat: LEGACY_CUTOFF_START + 60 },
      secret()
    );
    const { next, error } = await run(middleware, late);
    expect(error).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses emailed links and invites as sessions', async () => {
    const { middleware } = setup();
    for (const token of [
      signResetToken('user-1'),
      signActivationToken('user-1'),
      sign({ id: 'user-1', type: 'invite' }, secret(), { expiresIn: 60 }),
    ]) {
      const { next, error } = await run(middleware, token);
      expect(error).toBeDefined();
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('refuses a session issued before the password changed', async () => {
    const user = baseUser();
    user.sessionsRevokedAt = new Date(Date.now() + 5000);
    const { middleware } = setup(user);
    const { next, error } = await run(middleware, signSessionToken('user-1'));
    expect(error).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps a session issued after the password changed', async () => {
    const user = baseUser();
    user.sessionsRevokedAt = new Date(Date.now() - 5000);
    const { middleware } = setup(user);
    const { next, error } = await run(middleware, signSessionToken('user-1'));
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('re-issues a session past its halfway mark', async () => {
    const { middleware } = setup();
    const now = Math.floor(Date.now() / 1000);
    const old = sign(
      {
        id: 'user-1',
        type: 'session',
        iat: now - SESSION_TTL_SECONDS + 3600,
        exp: now + 3600,
      },
      secret()
    );
    const { next, cookies } = await run(middleware, old);
    expect(next).toHaveBeenCalled();
    expect(cookies).toHaveLength(1);
  });
});

describe('AuthMiddleware cross-site writes', () => {
  const token = signSessionToken('user-1');

  const attempt = async (headers: Record<string, string>) => {
    const { middleware } = setup();
    const cleared: string[] = [];
    const req: any = {
      method: 'POST',
      headers,
      cookies: { auth: token },
      originalUrl: '/user/api-key/rotate',
    };
    const res: any = {
      cookie: jest.fn(),
      clearCookie: (name: string) => cleared.push(name),
      header: jest.fn(),
    };
    const next = jest.fn();
    let error: any;
    try {
      await middleware.use(req, res, next);
    } catch (e) {
      error = e;
    }
    return { next, error, cleared };
  };

  it('refuses a cookie-authenticated write from another site, keeping the cookie', async () => {
    const { next, error, cleared } = await attempt({ origin: 'https://evil.example' });
    expect(next).not.toHaveBeenCalled();
    expect(error?.getStatus?.()).toBe(403);
    expect(cleared).toEqual([]);
  });

  it('allows the same write from our own origin', async () => {
    const { next, error } = await attempt({ origin: process.env.FRONTEND_URL! });
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe('session token rules', () => {
  it('allows a token issued in the same second as the revocation', () => {
    const revokedAt = new Date(1_800_000_000_500);
    expect(isRevokedSession(1_800_000_000, revokedAt)).toBe(false);
    expect(isRevokedSession(1_799_999_999, revokedAt)).toBe(true);
    expect(isRevokedSession(1_800_000_001, revokedAt)).toBe(false);
    expect(isRevokedSession(1_700_000_000, null)).toBe(false);
  });

  it('accepts the short-lived untyped session provisioning mints', () => {
    const now = Date.now();
    expect(
      checkSessionPayload(
        { id: 'u', iat: now / 1000, exp: now / 1000 + 600 },
        now
      )
    ).toEqual({ ok: true, userId: 'u', refresh: false });
  });

  it('stops accepting old-style sessions after the hard cutoff', () => {
    const legacy = { id: 'u', email: 'u@example.com', iat: LEGACY_CUTOFF_START - 10 };
    expect(checkSessionPayload(legacy, Date.UTC(2026, 9, 20)).ok).toBe(true);
    expect(checkSessionPayload(legacy, Date.UTC(2026, 10, 16)).ok).toBe(false);
  });

  it('refuses old-style emailed links as sessions', () => {
    const reset = { id: 'u', expires: '2026-10-01 10:00:00', iat: LEGACY_CUTOFF_START - 10 };
    const activation = { id: 'u', email: 'u@example.com', activated: false, iat: LEGACY_CUTOFF_START - 10 };
    expect(checkSessionPayload(reset, Date.UTC(2026, 9, 20)).ok).toBe(false);
    expect(checkSessionPayload(activation, Date.UTC(2026, 9, 20)).ok).toBe(false);
  });

  it('refuses a typed session without an expiry', () => {
    expect(checkSessionPayload({ id: 'u', type: 'session', iat: 1 }).ok).toBe(
      false
    );
  });
});
