/**
 * The version of the Terms people agree to when they sign up.
 */
export const CURRENT_TERMS_VERSION = '2026-09-20';

// People agree once, with the box on the sign-up form, and nobody is asked
// again: no screen in place of the app, and no request refused. The screen and
// the check in AuthMiddleware stay in the code and are driven by this.
export const needsTerms = (
  user?: { termsVersion?: string | null } | null
) => {
  return false;
};

export const termsAcceptance = (ip?: string) => ({
  termsVersion: CURRENT_TERMS_VERSION,
  termsAcceptedAt: new Date(),
  termsAcceptedIp: ip || null,
});

export const contactConsent = (ip?: string) => ({
  contactConsentAt: new Date(),
  contactConsentIp: ip || null,
});

export const contactConsentRequiredMessage = () =>
  'Please agree to receive emails from Voholabs to create an account';

export const termsRequiredMessage = () =>
  'Please agree to the Terms of Service and Privacy Policy to create an account';

// One row per agreement, written next to the fields above and never changed.
export const termsAcceptanceLog = (
  route: 'signup' | 'gate',
  ip?: string,
  userAgent?: string
) => ({
  termsAcceptances: {
    create: {
      version: CURRENT_TERMS_VERSION,
      route,
      ip: ip || null,
      userAgent: userAgent ? userAgent.slice(0, 500) : null,
    },
  },
});

// What a signed-in session that still has to agree may call: reading itself,
// agreeing, and leaving. The onboarding form comes first, so its path is open
// too.
export const termsOpenPaths = [
  '/user/self',
  '/user/terms',
  '/user/onboarding',
  '/user/logout',
];
