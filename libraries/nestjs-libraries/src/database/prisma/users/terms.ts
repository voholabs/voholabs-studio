/**
 * The Terms somebody agreed to are only worth something if we can show which
 * version they agreed to, and when. This is that version.
 *
 * Change it whenever /terms changes in a way people have to agree to again:
 * everybody whose stored version differs is asked once more the next time they
 * open the app.
 */
export const CURRENT_TERMS_VERSION = '2026-09-20';

export const needsTerms = (
  user?: { termsVersion?: string | null } | null
) => {
  return !!user && user.termsVersion !== CURRENT_TERMS_VERSION;
};

export const termsAcceptance = (ip?: string) => ({
  termsVersion: CURRENT_TERMS_VERSION,
  termsAcceptedAt: new Date(),
  termsAcceptedIp: ip || null,
});

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
// too. The public API and the MCP sign in with the organization's key, not a
// session, and are not held to this yet: turning that on cuts off integrations
// whose owner has not opened the app, so it needs an email notice first.
export const termsOpenPaths = [
  '/user/self',
  '/user/terms',
  '/user/onboarding',
  '/user/logout',
];
