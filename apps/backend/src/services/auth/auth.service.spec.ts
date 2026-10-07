process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.FRONTEND_URL = 'https://studio.example.com';

// Redis as the service uses it: get/set (with NX)/del.
const redis = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: async (key: string) => redis.get(key) ?? null,
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redis.has(key)) return null;
      redis.set(key, value);
      return 'OK';
    },
    del: async (key: string) => (redis.delete(key) ? 1 : 0),
  },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/newsletter/newsletter.service', () => ({
  NewsletterService: { register: async () => undefined },
}));
jest.mock('@gitroom/backend/services/auth/providers/providers.manager', () => ({
  AuthProviderManager: class {},
}));

import { sign, verify } from 'jsonwebtoken';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import {
  LEGACY_CUTOFF_START,
  signActivationToken,
  signResetToken,
  signSessionToken,
} from '@gitroom/helpers/auth/session.token';

const secret = () => process.env.JWT_SECRET!;

const make = (opts: { provider?: any } = {}) => {
  const user = {
    id: 'user-1',
    email: 'a@b.co',
    providerName: 'LOCAL',
    activated: false,
  };
  const users = {
    getUserById: jest.fn(async (id: string) => (id === user.id ? user : null)),
    getUserByEmail: jest.fn(async (email: string) =>
      email === user.email ? user : null
    ),
    getUserByProvider: jest.fn(async () => null),
    updatePassword: jest.fn(async () => ({ id: user.id })),
    activateUser: jest.fn(async () => {
      user.activated = true;
    }),
  };
  const notifications = { sendEmail: jest.fn(async () => undefined) };
  const email = { sendEmail: jest.fn(async () => undefined) };
  const providers = { getProvider: jest.fn(() => opts.provider) };
  const service = new AuthService(
    users as any,
    {} as any,
    notifications as any,
    email as any,
    providers as any
  );
  return { service, users, notifications, email, user };
};

beforeEach(() => redis.clear());

describe('password reset', () => {
  it('emails a reset token that is typed, expires in 20 minutes and has an id', async () => {
    const { service, notifications } = make();
    await service.forgot('a@b.co');
    const html = (notifications.sendEmail.mock.calls[0] as any[])[2] as string;
    const token = html.match(/auth\/forgot\/([^"]+)"/)![1];
    const payload = verify(token, secret()) as any;
    expect(payload.type).toBe('reset');
    expect(payload.exp - payload.iat).toBe(20 * 60);
    expect(typeof payload.jti).toBe('string');
  });

  it('works once', async () => {
    const { service, users } = make();
    const token = signResetToken('user-1');
    const body = { token, password: 'new-password', repeatPassword: '' };
    expect(await service.forgotReturn(body as any)).toBeTruthy();
    expect(await service.forgotReturn(body as any)).toBe(false);
    expect(users.updatePassword).toHaveBeenCalledTimes(1);
  });

  it('refuses a session or an activation link as a reset token', async () => {
    const { service, users } = make();
    for (const token of [
      signSessionToken('user-1'),
      signActivationToken('user-1'),
      // The old shape, with its own expiry claim and no type.
      sign({ id: 'user-1', expires: '2999-01-01 00:00:00' }, secret()),
    ]) {
      expect(
        await service.forgotReturn({ token, password: 'xxxxxxxx' } as any)
      ).toBe(false);
    }
    expect(users.updatePassword).not.toHaveBeenCalled();
  });
});

describe('activation', () => {
  it('activates with an activation link and signs in with a session', async () => {
    const { service, users } = make();
    const jwt = await service.activate(signActivationToken('user-1'), '');
    expect(users.activateUser).toHaveBeenCalledWith('user-1');
    expect(verify(jwt as string, secret())).toMatchObject({
      id: 'user-1',
      type: 'session',
    });
  });

  it('refuses a session or reset token as an activation link', async () => {
    const { service, users } = make();
    expect(await service.activate(signSessionToken('user-1'), '')).toBe(false);
    expect(await service.activate(signResetToken('user-1'), '')).toBe(false);
    expect(users.activateUser).not.toHaveBeenCalled();
  });

  it('still honours a link emailed before this release', async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 9, 20), advanceTimers: true });
    const { service, users } = make();
    const legacy = sign(
      { id: 'user-1', email: 'a@b.co', activated: false, iat: LEGACY_CUTOFF_START - 60 },
      secret()
    );
    expect(await service.activate(legacy, '')).toBeTruthy();
    expect(users.activateUser).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('resend activation', () => {
  it('answers the same for unknown, activated and pending addresses', async () => {
    const { service, user, email } = make();
    expect(await service.resendActivationEmail('nobody@b.co')).toBe(true);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(await service.resendActivationEmail('a@b.co')).toBe(true);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    user.activated = true;
    expect(await service.resendActivationEmail('a@b.co')).toBe(true);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('social sign-in', () => {
  const provider = () => ({
    requiresState: true,
    generateLink: jest.fn(
      (_q: unknown, state: string) => `https://idp.example/auth?state=${state}`
    ),
    getToken: jest.fn(async () => 'provider-access-token'),
    getUser: jest.fn(async () => ({ id: 'p-1', email: 'a@b.co' })),
  });

  it('requires the state from our own login link, once', async () => {
    const p = provider();
    const { service } = make({ provider: p });
    const link = (await service.oauthLink('GOOGLE')) as string;
    const state = new URL(link).searchParams.get('state')!;
    expect(state.startsWith('login_')).toBe(true);

    await expect(
      service.checkExists('GOOGLE', 'code', undefined, false, 'login_forged')
    ).rejects.toThrow();
    await expect(
      service.checkExists('GOOGLE', 'code', undefined, false, undefined)
    ).rejects.toThrow();
    expect(
      await service.checkExists('GOOGLE', 'code', undefined, false, state)
    ).toEqual({ token: 'provider-access-token' });
    await expect(
      service.checkExists('GOOGLE', 'code', undefined, false, state)
    ).rejects.toThrow();
  });

  it('only signs in with a provider token our code exchange produced', async () => {
    const p = provider();
    const { service } = make({ provider: p });
    const body = {
      provider: 'GOOGLE',
      providerToken: 'token-from-elsewhere',
      company: 'Acme',
      termsAccepted: true,
      contactConsent: true,
    };
    await expect(
      service.routeAuth('GOOGLE' as any, body as any, '1.1.1.1', 'ua', false)
    ).rejects.toThrow('Invalid provider token');
    expect(p.getUser).not.toHaveBeenCalled();
  });

  it('signs in with the provider token checkExists handed out', async () => {
    const p = provider();
    const { service, users } = make({ provider: p });
    const link = (await service.oauthLink('GOOGLE')) as string;
    const state = new URL(link).searchParams.get('state')!;
    const { token } = (await service.checkExists(
      'GOOGLE',
      'code',
      undefined,
      false,
      state
    )) as { token: string };

    users.getUserByProvider.mockResolvedValueOnce({ id: 'user-1' } as any);
    const { jwt } = await service.routeAuth(
      'GOOGLE' as any,
      { provider: 'GOOGLE', providerToken: token } as any,
      '1.1.1.1',
      'ua',
      false
    );
    expect(verify(jwt, secret())).toMatchObject({
      id: 'user-1',
      type: 'session',
    });
    // Used up.
    await expect(
      service.routeAuth(
        'GOOGLE' as any,
        { provider: 'GOOGLE', providerToken: token } as any,
        '1.1.1.1',
        'ua',
        false
      )
    ).rejects.toThrow('Invalid provider token');
  });
});
