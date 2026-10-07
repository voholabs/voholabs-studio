const possible =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// The largest multiple of the alphabet size that fits in a byte: bytes at or
// above it are thrown away so every character is equally likely.
const unbiasedLimit = 256 - (256 % possible.length);

// This file is shared by the backend, the frontend and the Temporal workflow
// bundle, so it cannot import Node's `crypto`: the Web Crypto global is the one
// source all of them can reach. Temporal workflow sandboxes do not expose it on
// purpose - their Math.random is seeded so a workflow replays to the same ids -
// so there, and only there, the seeded generator is what keeps replay working.
const webCrypto = (): { getRandomValues<T extends Uint8Array>(array: T): T } | undefined => {
  const c = (globalThis as any)?.crypto;
  return c && typeof c.getRandomValues === 'function' ? c : undefined;
};

export const makeId = (length: number) => {
  const crypto = webCrypto();
  if (!crypto) {
    let text = '';
    for (let i = 0; i < length; i += 1) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  let text = '';
  while (text.length < length) {
    const bytes = crypto.getRandomValues(
      // getRandomValues refuses more than 65,536 bytes per call.
      new Uint8Array(Math.min(65536, Math.max(16, (length - text.length) * 2)))
    );
    for (let i = 0; i < bytes.length && text.length < length; i += 1) {
      if (bytes[i] < unbiasedLimit) {
        text += possible.charAt(bytes[i] % possible.length);
      }
    }
  }
  return text;
};

/**
 * The `state` sent to a provider when a channel connect starts. It is what
 * ties the provider's callback back to the workspace that asked, so it is long
 * enough that it cannot be guessed and is used once.
 */
export const makeState = () => makeId(32);

/**
 * A PKCE code verifier (RFC 7636 section 4.1): 43-128 characters from the
 * unreserved set. Letters and digits are a subset of that set.
 */
export const makeCodeVerifier = () => makeId(64);
