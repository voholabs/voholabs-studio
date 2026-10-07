import { Agent, buildConnector } from 'undici';
import dns from 'node:dns';
import net from 'node:net';
import { isBlockedIp } from './webhook.url.validator';

// DNS pinning for hostnames: every resolved IP is checked with `isBlockedIp`
// and the socket connects to that same set. Closes the TOCTOU window
// `isSafePublicHttpsUrl` alone leaves open (see GHSA-f7jj-p389-4w45).
//
// Node's net/tls.connect never calls `lookup` when the host is already an IP
// literal, so this hook only covers hostnames. IP literals are checked in
// `guardedConnector` below.
export const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  if (net.isIP(hostname)) {
    const family = net.isIP(hostname);
    if (isBlockedIp(hostname)) {
      return callback(new Error('Blocked IP'), '', 0);
    }
    return options && (options as any).all
      ? callback(null, [{ address: hostname, family }] as any, family)
      : callback(null, hostname, family);
  }

  dns.lookup(hostname, options, (err, address: any, family: any) => {
    if (err) return callback(err, '', 0);
    if (Array.isArray(address)) {
      for (const entry of address) {
        if (isBlockedIp(entry.address)) {
          return callback(new Error('Blocked IP'), '', 0);
        }
      }
      return callback(null, address as any, 0);
    }
    if (isBlockedIp(address)) {
      return callback(new Error('Blocked IP'), '', 0);
    }
    callback(null, address, family);
  });
};

const baseConnector = buildConnector({ lookup: guardedLookup } as any);

// Every new socket the agent opens goes through here, including the ones
// opened for each redirect hop `fetch` follows (each hop is a new dispatch on
// this same agent), so redirects to an internal address are refused too.
export const guardedConnector: buildConnector.connector = (opts, callback) => {
  const host = String(opts.hostname || '').replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedIp(host)) {
    return callback(new Error('Blocked IP'), null);
  }
  return baseConnector(opts, callback);
};

export const ssrfSafeDispatcher = new Agent({
  connect: guardedConnector,
});

// Self-hosters legitimately connect Voholabs to WordPress/Mastodon/Lemmy/Listmonk
// instances that live on a private network (e.g. the same Docker network or VPC).
// Setting DISABLE_SSRF_PROTECTION=true opts those deployments out of the IP
// guard. It stays ON by default so the hosted product is protected.
export function getSsrfSafeDispatcher(): Agent | undefined {
  return process.env.DISABLE_SSRF_PROTECTION === 'true'
    ? undefined
    : ssrfSafeDispatcher;
}
