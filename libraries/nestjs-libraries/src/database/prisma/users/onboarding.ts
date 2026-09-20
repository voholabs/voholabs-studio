import {
  AccessOrganization,
  hasAccess,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

/**
 * Mandatory onboarding: a new account answers a few questions before it gets
 * to use the product, which is what the free plan is traded for.
 *
 * Nobody with the paid features is ever asked, and that is decided by
 * `hasAccess` and nothing narrower. It has to be the same test that grants the
 * features: an organization can have them through a paid row, a whitelist row,
 * or - on an install without billing - no row at all, and a check that only
 * knows some of those asks a customer to fill in a form to get back into a
 * product they already have.
 *
 * It looks at every organization the user belongs to, not only the one that is
 * selected: a member of a customer's organization is a customer's user, even
 * while their own free organization is the one on screen.
 */
export const needsOnboarding = (
  user?: { onboardedAt?: Date | string | null; isSuperAdmin?: boolean } | null,
  organizations?: (AccessOrganization | null | undefined)[]
) => {
  if (!user || user.onboardedAt || user.isSuperAdmin) {
    return false;
  }

  return !(organizations || []).some((organization) =>
    hasAccess(organization)
  );
};

// What an account that still has to onboard may call: reading itself,
// submitting the form, and leaving.
export const onboardingOpenPaths = [
  '/user/self',
  '/user/onboarding',
  '/user/logout',
];
