import dayjs from 'dayjs';

/**
 * Access / free trial.
 *
 * Everything runs on the existing Subscription row - a trial is simply a
 * whitelist entry that expires:
 *
 * - `cancelAt = null`        -> whitelisted forever (manual whitelist, and the
 *                               one-off backfill of the organizations that
 *                               existed before the trial shipped)
 * - `cancelAt` in the future -> free trial (or a time limited whitelist)
 * - `cancelAt` in the past   -> expired, the organization hits the paywall
 *
 * Organizations without any row at all keep the previous behaviour: unlimited
 * when billing is not configured, blocked when it is. That keeps self hosted
 * installs working and makes a missed backfill fail open instead of locking
 * people out.
 */
export const trialPeriodDays = () =>
  process.env.TRIAL_PERIOD_DAYS ? Number(process.env.TRIAL_PERIOD_DAYS) : 7;

export const paywallUrl = () =>
  process.env.PAYWALL_URL || 'https://voholabs.com';

export const billingEnabled = () =>
  !!process.env.STRIPE_PUBLISHABLE_KEY || !!process.env.STRIPE_SECRET_KEY;

export interface AccessSubscription {
  deletedAt?: Date | string | null;
  cancelAt?: Date | string | null;
  subscriptionTier?: string;
}

export interface AccessOrganization {
  subscription?: AccessSubscription | null;
}

export const isActiveSubscription = (
  subscription?: AccessSubscription | null
) =>
  !!subscription &&
  !subscription.deletedAt &&
  (!subscription.cancelAt || dayjs(subscription.cancelAt).isAfter(dayjs()));

export const hasAccess = (org?: AccessOrganization | null) =>
  org?.subscription ? isActiveSubscription(org.subscription) : !billingEnabled();

// When the free trial (or a time limited whitelist) runs out. `null` means the
// organization is whitelisted forever, so there is nothing to count down.
export const trialEndsAt = (org?: AccessOrganization | null) =>
  org?.subscription && !org.subscription.deletedAt
    ? org.subscription.cancelAt || null
    : null;

// Rounded up, so a fresh 7 day trial reads "7 days left" and not "6".
export const trialDaysLeft = (org?: AccessOrganization | null) => {
  const endsAt = trialEndsAt(org);
  return endsAt
    ? Math.max(0, Math.ceil(dayjs(endsAt).diff(dayjs(), 'hour') / 24))
    : null;
};

export const newTrialCancelAt = () =>
  dayjs().add(trialPeriodDays(), 'day').toDate();

export const trialExpiredMessage = () =>
  `Your ${trialPeriodDays()}-day free trial has ended. Please contact sales to continue using the platform.`;
