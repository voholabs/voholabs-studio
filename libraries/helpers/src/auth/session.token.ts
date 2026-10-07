import { randomUUID } from 'crypto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

/**
 * Every token signed with JWT_SECRET says what it is for (`type`) and when it
 * stops working (`exp`). The sign-in session is `type: 'session'`; the links we
 * email (password reset, account activation) and team invites each have their
 * own type, so one can never be used as another.
 */
export type TokenType = 'session' | 'reset' | 'activate' | 'invite';

// How long a sign-in lasts. Active users never see it run out: a session past
// the halfway mark is re-issued on the next request (SESSION_REFRESH_AFTER).
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_REFRESH_AFTER_SECONDS = SESSION_TTL_SECONDS / 2;

export const RESET_TTL_SECONDS = 20 * 60;
export const ACTIVATE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const INVITE_TTL_SECONDS = 2 * 24 * 60 * 60;

// Sessions signed before this release carry no `type` and no `exp`. They are
// still honoured, and swapped for a current session on the request that shows
// one, but only if they were signed before this release went out (iat before
// LEGACY_CUTOFF_START, in seconds): nothing signs that shape any more, so a
// newer one is not ours.
export const LEGACY_CUTOFF_START = Date.UTC(2026, 9, 9, 0, 0, 0) / 1000;

// After this date an old-style session is refused outright, and its holder
// signs in again. By then everybody who uses the app has been moved over.
export const LEGACY_HARD_CUTOFF_MS = Date.UTC(2026, 10, 15, 0, 0, 0);

type Payload = {
  id?: string;
  type?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
};

export const signSessionToken = (userId: string) =>
  AuthService.signJWT(
    { id: userId, type: 'session' },
    { expiresIn: SESSION_TTL_SECONDS }
  );

export const signResetToken = (userId: string) =>
  AuthService.signJWT(
    { id: userId, type: 'reset' },
    { expiresIn: RESET_TTL_SECONDS, jwtid: randomUUID() }
  );

export const signActivationToken = (userId: string) =>
  AuthService.signJWT(
    { id: userId, type: 'activate' },
    { expiresIn: ACTIVATE_TTL_SECONDS }
  );

/**
 * Verifies the signature and expiry, then the type. Returns null for anything
 * that is not a valid token of that type.
 */
export const verifyTypedToken = (
  token: string | undefined,
  type: TokenType
): Payload | null => {
  if (!token || typeof token !== 'string') {
    return null;
  }
  try {
    const payload = AuthService.verifyJWT(token) as Payload | string;
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    if (payload.type !== type || typeof payload.exp !== 'number') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

/** Signed before this release (no type, no expiry) and still inside the window. */
export const isInLegacyWindow = (payload: Payload, now = Date.now()) =>
  payload.type === undefined &&
  payload.exp === undefined &&
  typeof payload.iat === 'number' &&
  payload.iat < LEGACY_CUTOFF_START &&
  now < LEGACY_HARD_CUTOFF_MS;

/**
 * An old-style sign-in session. Only the shape an old sign-in produced: the
 * user record (so it carries an email) with nothing that marks an emailed
 * link (`expires` on a reset link, `activated: false` on an activation link).
 */
export const isLegacyToken = (payload: Payload, now = Date.now()) =>
  isInLegacyWindow(payload, now) &&
  typeof payload.email === 'string' &&
  payload.expires === undefined &&
  payload.activated !== false;

export type SessionCheck =
  | { ok: false }
  | { ok: true; userId: string; refresh: boolean };

/**
 * Decides whether an already signature-checked payload is a usable sign-in
 * session, and whether a fresh one should be handed back.
 *
 * - `type: 'session'` with an `exp`: yes. Re-issued once past the halfway mark.
 * - Any other `type` (an emailed link, an invite): no.
 * - No `type` but an `exp`: yes, not re-issued. That is the short-lived session
 *   ProvisionController mints for a trusted server, which spends it at once.
 * - No `type` and no `exp`: only an old-style session (see isLegacyToken), and
 *   it is always re-issued so its holder moves to the current kind.
 */
export const checkSessionPayload = (
  payload: unknown,
  now = Date.now()
): SessionCheck => {
  if (!payload || typeof payload !== 'object') {
    return { ok: false };
  }
  const p = payload as Payload;
  if (!p.id || typeof p.id !== 'string') {
    return { ok: false };
  }

  if (p.type !== undefined) {
    if (p.type !== 'session' || typeof p.exp !== 'number') {
      return { ok: false };
    }
    return {
      ok: true,
      userId: p.id,
      refresh: p.exp - now / 1000 < SESSION_REFRESH_AFTER_SECONDS,
    };
  }

  if (typeof p.exp === 'number') {
    return { ok: true, userId: p.id, refresh: false };
  }

  if (isLegacyToken(p, now)) {
    return { ok: true, userId: p.id, refresh: true };
  }

  return { ok: false };
};

/**
 * True when the token was issued before the user's sessions were revoked (a
 * password change). Compared in whole seconds, the resolution of `iat`, and a
 * token issued in the same second as the revocation is kept: that is the
 * person who just changed it signing straight back in.
 */
export const isRevokedSession = (
  iat: unknown,
  sessionsRevokedAt?: Date | string | null
) => {
  if (!sessionsRevokedAt) {
    return false;
  }
  const revokedAt = new Date(sessionsRevokedAt).getTime();
  if (Number.isNaN(revokedAt)) {
    return false;
  }
  if (typeof iat !== 'number') {
    return true;
  }
  return iat < Math.floor(revokedAt / 1000);
};
