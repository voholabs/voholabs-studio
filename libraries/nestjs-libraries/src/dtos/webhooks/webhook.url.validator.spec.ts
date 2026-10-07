import {
  isBlockedIp,
  isBlockedIPv4,
  isSafePublicUrl,
  isSafePublicHttpsUrl,
  parseIPv6,
} from './webhook.url.validator';
import dns from 'node:dns/promises';

describe('isBlockedIPv4', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
  ])('allows %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(false);
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('blocks anything that is not a dotted quad', () => {
    expect(isBlockedIPv4('127.1')).toBe(true);
    expect(isBlockedIPv4('256.0.0.1')).toBe(true);
    expect(isBlockedIPv4('a.b.c.d')).toBe(true);
  });
});

describe('parseIPv6', () => {
  it('expands compressed forms and dotted tails', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x7f00, 1,
    ]);
    expect(parseIPv6('[2001:db8::1]')).toEqual([
      0x2001, 0xdb8, 0, 0, 0, 0, 0, 1,
    ]);
    expect(parseIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('1.2.3.4')).toBeNull();
  });
});

describe('isBlockedIp (IPv6)', () => {
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback, long form'],
    ['::ffff:127.0.0.1', 'mapped, dotted'],
    ['::ffff:7f00:1', 'mapped, hex (WHATWG serialisation)'],
    ['::ffff:a00:1', 'mapped 10.0.0.1'],
    ['::ffff:a9fe:a9fe', 'mapped metadata IP'],
    ['::ffff:0:7f00:1', 'SIIT translated'],
    ['::127.0.0.1', 'IPv4-compatible, dotted'],
    ['::7f00:1', 'IPv4-compatible, hex'],
    ['::a9fe:a9fe', 'IPv4-compatible metadata IP'],
    ['64:ff9b::7f00:1', 'NAT64 loopback'],
    ['64:ff9b::10.0.0.1', 'NAT64 private, dotted'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['2002:7f00:1::', '6to4 of 127.0.0.1'],
    ['2002:c0a8:101::1', '6to4 of 192.168.1.1'],
    ['2001:0:4136:e378:8000:63bf:80ff:fffe', 'Teredo of 127.0.0.1'],
    ['2001:0:4136:e378:8000:63bf:f5ff:fffe', 'Teredo of 10.0.0.1'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local upper'],
    ['fec0::1', 'site-local'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['100::1', 'discard'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:808:808', // mapped 8.8.8.8
    '64:ff9b::808:808', // NAT64 of 8.8.8.8
    '2002:808:808::1', // 6to4 of 8.8.8.8
    '2001:0:4136:e378:8000:63bf:f7f7:f7f7', // Teredo of 8.8.8.8
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('blocks things that are not IPs', () => {
    expect(isBlockedIp('localhost')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

describe('isSafePublicUrl', () => {
  let lookup: jest.SpyInstance;
  beforeEach(() => {
    lookup = jest
      .spyOn(dns, 'lookup')
      .mockImplementation(async (host: any) => {
        if (host === 'public.example') {
          return [{ address: '93.184.216.34', family: 4 }] as any;
        }
        if (host === 'rebind.example') {
          return [
            { address: '93.184.216.34', family: 4 },
            { address: '127.0.0.1', family: 4 },
          ] as any;
        }
        throw new Error('ENOTFOUND');
      });
  });
  afterEach(() => lookup.mockRestore());

  it.each([
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:a00:1]/',
    'https://[64:ff9b::7f00:1]/',
    'https://[::127.0.0.1]/',
    'https://[::7f00:1]/',
    'https://169.254.169.254/latest/meta-data',
    'https://2130706433/', // decimal 127.0.0.1
    'https://0x7f.0.0.1/', // hex octet
    'https://0x7f000001/', // hex whole
    'https://017700000001/', // octal whole
    'https://0177.0.0.1/', // octal octet
    'https://127.1/', // short form
    'https://localhost/',
    'https://LOCALHOST./',
    'https://api.localhost/',
    'https://rebind.example/',
    'https://nxdomain.example/',
    'http://public.example/',
    'ftp://public.example/',
    'not a url',
  ])('rejects %s', async (url) => {
    expect(await isSafePublicUrl(url)).toBe(false);
    expect(await isSafePublicHttpsUrl(url)).toBe(false);
  });

  it('accepts a public https URL', async () => {
    expect(await isSafePublicUrl('https://public.example/feed')).toBe(true);
    expect(await isSafePublicHttpsUrl('https://8.8.8.8/')).toBe(true);
  });

  it('accepts http only when asked', async () => {
    expect(
      await isSafePublicUrl('http://public.example/', { allowHttp: true })
    ).toBe(true);
    expect(
      await isSafePublicUrl('http://2130706433/', { allowHttp: true })
    ).toBe(false);
  });
});
