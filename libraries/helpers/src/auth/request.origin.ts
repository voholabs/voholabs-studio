/**
 * Which browser origins may make cookie-authenticated requests that change
 * state. A request a browser sends from another site carries that site's
 * `Origin` (or, failing that, a `Referer`), so a value outside this list is
 * refused. Requests authenticated with the `auth` header (the mobile bridge,
 * scripts) are not browser form posts and are not subject to this check.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const originOf = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

export const allowedBrowserOrigins = (env = process.env): Set<string> => {
  const list = [
    env.FRONTEND_URL,
    env.MAIN_URL,
    env.NEXT_PUBLIC_BACKEND_URL,
    'http://localhost:6274',
  ]
    .map((v) => originOf(v))
    .filter((v): v is string => !!v);
  return new Set(list);
};

export type OriginCheckInput = {
  method: string;
  usesCookie: boolean;
  origin?: string;
  referer?: string;
};

/**
 * True when the request may proceed. Reads are always fine; so is anything
 * not authenticated by cookie. For a cookie-authenticated write, a present
 * `Origin` (else `Referer`) must be one of ours. A write with neither header
 * is allowed: browsers always send `Origin` on cross-site posts, so its
 * absence means a non-browser client.
 */
export const isAllowedBrowserRequest = (
  input: OriginCheckInput,
  allowed: Set<string> = allowedBrowserOrigins()
): boolean => {
  if (SAFE_METHODS.has((input.method || 'GET').toUpperCase()) || !input.usesCookie) {
    return true;
  }
  const source =
    (input.origin && input.origin !== 'null' ? originOf(input.origin) : undefined) ??
    originOf(input.referer);
  if (input.origin === 'null') return false;
  if (!source) return true;
  return allowed.has(source);
};
