import { parse } from 'tldts';

// Hosts whose registrable domain browsers treat as a public suffix. Setting
// `Domain=.railway.app` on one of these gets the cookie rejected outright, so
// the auth cookie is dropped and login never persists - fall back to a
// host-only cookie there. Real custom domains (studio.voholabs.com ->
// .voholabs.com) keep the shared-subdomain cookie.
const PAAS_APEXES = [
  'railway.app',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'onrender.com',
  'fly.dev',
];

export function getCookieUrlFromDomain(domain: string) {
  const url = parse(domain);

  if (!url.domain || PAAS_APEXES.includes(url.domain)) {
    return url.hostname!;
  }

  return '.' + url.domain;
}
