import {
  AccessOrganization,
  isActiveSubscription,
  isPaidSubscription,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

/**
 * Mandatory onboarding: a new account answers a few questions before it gets
 * to use the product, which is what the free plan is traded for.
 *
 * Paying customers and organizations whitelisted forever are never asked. They
 * were here before the form existed, and the product has to keep working for
 * them exactly as it did.
 */
export const needsOnboarding = (
  user?: { onboardedAt?: Date | string | null; isSuperAdmin?: boolean } | null,
  org?: AccessOrganization | null
) => {
  if (!user || user.onboardedAt || user.isSuperAdmin) {
    return false;
  }

  const subscription = org?.subscription;
  const whitelistedForever =
    isActiveSubscription(subscription) && !subscription?.cancelAt;

  return !isPaidSubscription(subscription) && !whitelistedForever;
};

// What an account that still has to onboard may call: reading itself,
// submitting the form, and leaving.
export const onboardingOpenPaths = [
  '/user/self',
  '/user/onboarding',
  '/user/logout',
];
