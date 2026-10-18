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
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({
    UsersService: class {},
  })
);
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
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
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
    getProviderUserByEmail: jest.fn(
      async (_email: string, _providers: string[]): Promise<any> => null
    ),
    updatePassword: jest.fn(async () => ({ id: user.id })),
    activateUser: jest.fn(async () => {
      user.activated = true;
    }),
  };
  const email = {
    sendEmailSync: jest.fn(async () => undefined),
    hasProvider: jest.fn(() => true),
  };
  const providers = {
    getProvider: jest.fn(() => opts.provider),
    emailVerifyingProviders: jest.fn(() => ['GOOGLE', 'GITHUB']),
  };
  const service = new AuthService(
    users as any,
    {} as any,
    email as any,
    providers as any
  );
  return { service, users, email, user };
};

beforeEach(() => redis.clear());

describe('password reset', () => {
  it('emails a reset token that is typed, expires in 20 minutes and has an id', async () => {
    const { service, email } = make();
    await service.forgot('a@b.co');
    const html = (email.sendEmailSync.mock.calls[0] as any[])[2] as string;
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
      {
        id: 'user-1',
        email: 'a@b.co',
        activated: false,
        iat: LEGACY_CUTOFF_START - 60,
      },
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
    expect(email.sendEmailSync).not.toHaveBeenCalled();
    expect(await service.resendActivationEmail('a@b.co')).toBe(true);
    expect(email.sendEmailSync).toHaveBeenCalledTimes(1);
    user.activated = true;
    expect(await service.resendActivationEmail('a@b.co')).toBe(true);
    expect(email.sendEmailSync).toHaveBeenCalledTimes(1);
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

// One person, one account: signing in with Google finds the email+password
// account for the same address, and a Google account can add a password.
describe('account linking by email', () => {
  const googleUser = (emailVerified: boolean) => ({
    requiresState: false,
    verifiesEmail: true,
    generateLink: jest.fn(),
    getToken: jest.fn(async () => 'provider-access-token'),
    getUser: jest.fn(async () => ({
      id: 'google-1',
      email: 'a@b.co',
      emailVerified,
    })),
  });

  it('signs in to the activated email+password account when Google verified the address', async () => {
    const { service, user } = make({ provider: googleUser(true) });
    user.activated = true;
    const result = (await service.checkExists('GOOGLE', 'code')) as any;
    expect(verify(result.jwt, secret())).toMatchObject({ id: 'user-1' });
  });

  it('does not link when the provider did not verify the address', async () => {
    const { service, user } = make({ provider: googleUser(false) });
    user.activated = true;
    expect(await service.checkExists('GOOGLE', 'code')).toEqual({
      token: 'provider-access-token',
    });
  });

  it('does not link into an account that was never activated', async () => {
    const { service } = make({ provider: googleUser(true) });
    expect(await service.checkExists('GOOGLE', 'code')).toEqual({
      token: 'provider-access-token',
    });
  });

  it('refuses a second, email+password account for an address that signs in with Google', async () => {
    const { service, users } = make();
    users.getProviderUserByEmail.mockImplementation(async (_e, providers) =>
      providers.includes('GOOGLE')
        ? ({
            id: 'google-user',
            providerName: 'GOOGLE',
            password: '',
          } as any)
        : null
    );
    const body = Object.assign(new CreateOrgUserDto(), {
      email: 'g@b.co',
      password: 'xxxxxxxx',
      termsAccepted: true,
      contactConsent: true,
    });
    await expect(
      service.routeAuth('LOCAL' as any, body, '1.1.1.1', 'ua')
    ).rejects.toThrow('This email signs in with Google');
  });

  it('points a password login on a Google account without a password at Google', async () => {
    const { service, users } = make();
    users.getProviderUserByEmail.mockImplementation(async (_e, providers) =>
      providers.includes('GOOGLE')
        ? ({
            id: 'google-user',
            providerName: 'GOOGLE',
            password: '',
            activated: true,
          } as any)
        : null
    );
    await expect(
      service.routeAuth(
        'LOCAL' as any,
        { email: 'g@b.co', password: 'xxxxxxxx' } as any,
        '1.1.1.1',
        'ua'
      )
    ).rejects.toThrow('Forgot password');
  });

  it('signs a Google account in with the password it added', async () => {
    const { service, users } = make();
    users.getProviderUserByEmail.mockImplementation(async (_e, providers) =>
      providers.includes('GOOGLE')
        ? ({
            id: 'google-user',
            providerName: 'GOOGLE',
            password: AuthChecker.hashPassword('added-password'),
            activated: true,
          } as any)
        : null
    );
    const { jwt } = (await service.routeAuth(
      'LOCAL' as any,
      { email: 'g@b.co', password: 'added-password' } as any,
      '1.1.1.1',
      'ua'
    )) as any;
    expect(verify(jwt, secret())).toMatchObject({ id: 'google-user' });
  });

  it('emails a Google account the link that adds a password', async () => {
    const { service, users, email } = make();
    users.getProviderUserByEmail.mockImplementation(async (_e, providers) =>
      providers.includes('GOOGLE')
        ? ({
            id: 'google-user',
            providerName: 'GOOGLE',
          } as any)
        : null
    );
    await service.forgot('g@b.co');
    const html = (email.sendEmailSync.mock.calls[0] as any[])[2] as string;
    const token = html.match(/auth\/forgot\/([^"]+)"/)![1];
    expect(verify(token, secret())).toMatchObject({
      id: 'google-user',
      type: 'reset',
    });
  });

  it('links through the sign-in that follows the register form too', async () => {
    const p = { ...googleUser(true), requiresState: false };
    const { service, user } = make({ provider: p });
    // Not activated yet when Google is first tried, so a token comes back...
    const { token } = (await service.checkExists('GOOGLE', 'code')) as any;
    // ...and by the time the form is sent the account was activated.
    user.activated = true;
    const { jwt } = (await service.routeAuth(
      'GOOGLE' as any,
      { provider: 'GOOGLE', providerToken: token } as any,
      '1.1.1.1',
      'ua',
      false
    )) as any;
    expect(verify(jwt, secret())).toMatchObject({ id: 'user-1' });
  });

  it("prefers the provider's own account over the address", async () => {
    const { service, users, user } = make({ provider: googleUser(true) });
    user.activated = true;
    users.getUserByProvider.mockResolvedValueOnce({ id: 'google-own' } as any);
    const result = (await service.checkExists('GOOGLE', 'code')) as any;
    expect(verify(result.jwt, secret())).toMatchObject({ id: 'google-own' });
    expect(users.getUserByEmail).not.toHaveBeenCalled();
  });

  it('does not link for a provider that does not verify addresses', async () => {
    const p = { ...googleUser(true), verifiesEmail: false };
    const { service, user } = make({ provider: p });
    user.activated = true;
    expect(await service.checkExists('GENERIC', 'code')).toEqual({
      token: 'provider-access-token',
    });
  });

  it('does not link without an email provider, where accounts activate without a link', async () => {
    const { service, user, email } = make({ provider: googleUser(true) });
    user.activated = true;
    email.hasProvider.mockReturnValue(false);
    expect(await service.checkExists('GOOGLE', 'code')).toEqual({
      token: 'provider-access-token',
    });
  });

  it('never offers a password to an account of a provider that does not verify addresses', async () => {
    const { service, users, email } = make();
    users.getProviderUserByEmail.mockImplementation(async (_e, providers) =>
      providers.includes('GENERIC')
        ? ({ id: 'generic-user', providerName: 'GENERIC' } as any)
        : null
    );
    expect(await service.forgot('g@b.co')).toBe(false);
    expect(email.sendEmailSync).not.toHaveBeenCalled();
  });

  it('rejects a wrong password on a Google account that added one', async () => {
    const { service, users } = make();
    users.getProviderUserByEmail.mockResolvedValue({
      id: 'google-user',
      providerName: 'GOOGLE',
      password: AuthChecker.hashPassword('added-password'),
      activated: true,
    });
    await expect(
      service.routeAuth(
        'LOCAL' as any,
        { email: 'g@b.co', password: 'wrong-password' } as any,
        '1.1.1.1',
        'ua'
      )
    ).rejects.toThrow('Invalid user name or password');
  });
});
