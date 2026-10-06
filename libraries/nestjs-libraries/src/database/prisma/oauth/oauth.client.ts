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

// Schemes that run or read something in the browser instead of handing the
// code to an app.
const BLOCKED_SCHEMES = [
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'about:',
  'blob:',
  'ftp:',
  'ws:',
  'wss:',
];

// What a self-registering client may ask to be sent back to (RFC 8252): an
// https URL (Claude, ChatGPT), a loopback http URL (Claude Code, VS Code), or a
// desktop app's own link scheme (cursor://...).
export const isAllowedRedirectUri = (uri: string) => {
  const url = parse(uri);
  if (!url || url.hash || url.username || url.password) {
    return false;
  }
  if (url.protocol === 'https:' || isLoopback(url)) {
    return true;
  }
  return (
    url.protocol !== 'http:' &&
    !BLOCKED_SCHEMES.includes(url.protocol) &&
    /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
  );
};

// What the consent screen names as the place the user is sent back to.
export const redirectLabel = (uri: string) => {
  const url = parse(uri);
  if (!url) {
    return '';
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    return url.host;
  }
  return `${url.protocol}//${url.host}`;
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
