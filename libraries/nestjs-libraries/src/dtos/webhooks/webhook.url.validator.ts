import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

// Parses a strict dotted-quad IPv4 address into its 32-bit value.
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

// [network, prefix length] pairs for IPv4 space that is not publicly routable.
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

const BLOCKED_IPV4_MASKS = BLOCKED_IPV4_RANGES.map(([network, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (ipv4ToInt(network)! & mask) >>> 0, mask };
});

export function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true;
  return BLOCKED_IPV4_MASKS.some(
    ({ network, mask }) => ((value & mask) >>> 0) === network
  );
}

// Expands any textual IPv6 address (compressed, with an embedded dotted IPv4
// tail, with a zone id) into its eight 16-bit groups. Returns null when the
// input is not IPv6.
export function parseIPv6(input: string): number[] | null {
  let ip = input.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (net.isIP(ip) !== 6) return null;

  // Convert a trailing dotted IPv4 into two hex groups.
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    ip =
      ip.slice(0, lastColon + 1) +
      ((v4 >>> 16) & 0xffff).toString(16) +
      ':' +
      (v4 & 0xffff).toString(16);
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;

  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill('0'),
    ...rest,
  ].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));

  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups;
}

function groupsToIpv4(high: number, low: number): string {
  return intToIpv4(((high << 16) | low) >>> 0);
}

// Returns the IPv4 address an IPv6 address carries inside it (mapped,
// compatible, SIIT, NAT64, 6to4, Teredo), or null when there is none.
export function embeddedIPv4(groups: number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0;

  // ::ffff:a.b.c.d (mapped) and ::ffff:0:a.b.c.d (SIIT translated)
  if (zeroPrefix && g4 === 0 && g5 === 0xffff) return groupsToIpv4(g6, g7);
  if (zeroPrefix && g4 === 0xffff && g5 === 0) return groupsToIpv4(g6, g7);
  // ::a.b.c.d (deprecated IPv4-compatible); :: and ::1 are handled separately
  if (zeroPrefix && g4 === 0 && g5 === 0) return groupsToIpv4(g6, g7);
  // 64:ff9b::/96 well-known NAT64 prefix
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return groupsToIpv4(g6, g7);
  }
  // 2002::/16 6to4: IPv4 sits in bits 16-47
  if (g0 === 0x2002) return groupsToIpv4(g1, g2);
  // 2001:0::/32 Teredo: client IPv4 is the last 32 bits, inverted
  if (g0 === 0x2001 && g1 === 0) {
    return groupsToIpv4(g6 ^ 0xffff, g7 ^ 0xffff);
  }
  return null;
}

export function isBlockedIPv6(ip: string): boolean {
  const groups = parseIPv6(ip);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  if (groups.every((g) => g === 0)) return true; // :: unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1

  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard
  // 64:ff9b:1::/48 local-use NAT64 (RFC 8215): never a public destination
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true;

  const v4 = embeddedIPv4([g0, g1, g2, g3, g4, g5, g6, g7]);
  if (v4 !== null) return isBlockedIPv4(v4);

  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (typeof ip !== 'string') return true;
  const cleaned = ip.trim().replace(/^\[|\]$/g, '');
  const withoutZone = cleaned.split('%')[0];
  const version = net.isIP(withoutZone);
  if (version === 4) {
    return isBlockedIPv4(withoutZone);
  }
  if (version === 6) {
    return isBlockedIPv6(withoutZone);
  }
  return true;
}

// Names that resolve to the local machine without asking DNS.
function isLocalHostname(hostname: string): boolean {
  const name = hostname.replace(/\.+$/, '');
  return name === 'localhost' || name.endsWith('.localhost');
}

/**
 * Checks that `value` is an absolute URL on a public host. Hostnames are
 * read from `new URL(value).hostname`, which already turns decimal, octal
 * and hex IPv4 spellings (`2130706433`, `0x7f.0.0.1`, `017700000001`) into
 * dotted form, so those are checked like any other IP literal.
 *
 * https only unless `allowHttp` is set.
 */
export async function isSafePublicUrl(
  value: unknown,
  { allowHttp = false }: { allowHttp?: boolean } = {}
): Promise<boolean> {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const protocolOk =
    parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:');
  if (!protocolOk) {
    return false;
  }

  if (!parsed.hostname) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (isLocalHostname(hostname)) {
    return false;
  }

  // If user supplied a literal IP directly, validate it immediately
  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion) {
    return !isBlockedIp(hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true });

    if (!records.length) {
      return false;
    }

    for (const record of records) {
      if (isBlockedIp(record.address)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export async function isSafePublicHttpsUrl(value: unknown): Promise<boolean> {
  return isSafePublicUrl(value);
}

@ValidatorConstraint({ name: 'IsSafeWebhookUrl', async: true })
export class IsSafeWebhookUrlConstraint implements ValidatorConstraintInterface {
  async validate(value: unknown, _args: ValidationArguments): Promise<boolean> {
    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL must be a public HTTPS URL and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsSafeWebhookUrlConstraint,
    });
  };
}