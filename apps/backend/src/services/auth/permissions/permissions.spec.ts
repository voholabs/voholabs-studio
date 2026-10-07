// Run from the repo root:
//   pnpm exec jest -c libraries/nestjs-libraries/jest.config.ts \
//     --roots '<rootDir>/apps/backend/src' apps/backend/src/services/auth/permissions
// Plain stubs only.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  () => ({ WebhooksService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service', () => ({
  WalletService: class {},
}));
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { skipsPolicies } from '@gitroom/backend/services/auth/permissions/permissions.guard';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

const whitelisted: Record<string, unknown> = {
  id: 's1',
  subscriptionTier: 'PRO',
  totalChannels: 10,
  cancelAt: null,
  deletedAt: null,
  isLifetime: true,
};

const service = () =>
  new PermissionsService(
    {
      getSubscriptionByOrganizationId: jest.fn(async () => whitelisted),
      getSubscription: jest.fn(async () => whitelisted),
    } as any,
    {} as any,
    { getIntegrationsList: jest.fn(async () => []) } as any,
    {} as any,
    { unlocks: jest.fn(async () => false) } as any
  );

const can = async (
  role: 'USER' | 'ADMIN' | 'SUPERADMIN',
  section: Sections
) => {
  const ability = await service().check('org', new Date(), role, [
    [AuthorizationActions.Create, section],
  ]);
  return ability.can(AuthorizationActions.Create, section);
};

describe('PermissionsService ADMIN section', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('without Stripe', () => {
    beforeEach(() => {
      process.env = { ...OLD_ENV };
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    });

    it('still lifts plan limits for everyone', async () => {
      expect(await can('USER', Sections.AI)).toBe(true);
      expect(await can('USER', Sections.CHANNEL)).toBe(true);
    });

    it('keeps ADMIN to admins', async () => {
      expect(await can('USER', Sections.ADMIN)).toBe(false);
      expect(await can('ADMIN', Sections.ADMIN)).toBe(true);
      expect(await can('SUPERADMIN', Sections.ADMIN)).toBe(true);
    });
  });

  describe('with Stripe', () => {
    beforeEach(() => {
      process.env = { ...OLD_ENV, STRIPE_PUBLISHABLE_KEY: 'pk_test' };
    });

    it('keeps ADMIN to admins', async () => {
      expect(await can('USER', Sections.ADMIN)).toBe(false);
      expect(await can('ADMIN', Sections.ADMIN)).toBe(true);
    });
  });
});

describe('skipsPolicies', () => {
  it('skips sign-in and the connect callbacks', () => {
    expect(skipsPolicies('/auth')).toBe(true);
    expect(skipsPolicies('/auth/login')).toBe(true);
    expect(skipsPolicies('/integrations/social-connect/x')).toBe(true);
    expect(skipsPolicies('/integrations/provider/abc/connect')).toBe(true);
  });

  it('checks routes that only contain those words', () => {
    expect(skipsPolicies('/skills/authority-building')).toBe(false);
    expect(skipsPolicies('/public/v1/skills/auth')).toBe(false);
    expect(skipsPolicies('/authors')).toBe(false);
    expect(skipsPolicies('/oauth/authorize')).toBe(false);
    expect(skipsPolicies('/integrations/providers')).toBe(false);
    expect(skipsPolicies('/posts')).toBe(false);
  });
});
