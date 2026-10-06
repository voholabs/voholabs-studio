import { createHash } from 'crypto';

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

const parse = (uri: string) => {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
};

const isLoopback = (url: URL) =>
  url.protocol === 'http:' && LOOPBACK.includes(url.hostname);

// What a self-registering client may ask to be sent back to: an https URL, or
// a loopback http URL for a native client such as Claude Code (RFC 8252).
export const isAllowedRedirectUri = (uri: string) => {
  const url = parse(uri);
  if (!url || url.hash || url.username || url.password) {
    return false;
  }
  return url.protocol === 'https:' || isLoopback(url);
};

// The registered URI the request names, or null. A loopback URI matches on any
// port, because a native client listens on a different port each time.
export const matchRedirectUri = (registered: string[], requested: string) => {
  const want = parse(requested);
  if (!want) {
    return null;
  }
  for (const candidate of registered) {
    if (candidate === requested) {
      return requested;
    }
    const have = parse(candidate);
    if (
      have &&
      isLoopback(have) &&
      isLoopback(want) &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    ) {
      return requested;
    }
  }
  return null;
};

// PKCE S256: base64url(sha256(verifier)) must equal the challenge.
export const verifyPkce = (verifier: string, challenge: string) =>
  createHash('sha256').update(verifier).digest('base64url') === challenge;
