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
