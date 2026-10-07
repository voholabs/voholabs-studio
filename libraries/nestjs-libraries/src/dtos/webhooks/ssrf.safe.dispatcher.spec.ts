import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import { AddressInfo } from 'node:net';
import { Agent } from 'undici';
import {
  guardedConnector,
  guardedLookup,
  ssrfSafeDispatcher,
} from './ssrf.safe.dispatcher';

// Real sockets against servers on the loopback interface: no outside network.

const listen = (host: string) =>
  new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://127.0.0.1:${v4Port}/` });
        return res.end();
      }
      res.end('reached');
    });
    server.once('error', reject);
    server.listen(0, host, () => resolve(server));
  });

let v4Server: http.Server;
let v4Port: number;
let v6Server: http.Server | undefined;
let v6Port: number | undefined;

beforeAll(async () => {
  v4Server = await listen('127.0.0.1');
  v4Port = (v4Server.address() as AddressInfo).port;
  try {
    v6Server = await listen('::1');
    v6Port = (v6Server.address() as AddressInfo).port;
  } catch {
    v6Server = undefined; // no IPv6 loopback on this machine
  }
});

afterAll(async () => {
  await new Promise((r) => v4Server.close(r));
  if (v6Server) await new Promise((r) => v6Server!.close(r));
  await ssrfSafeDispatcher.close().catch(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const viaDispatcher = (url: string, dispatcher: any = ssrfSafeDispatcher) =>
  fetch(url, {
    // @ts-ignore — undici option
    dispatcher,
  });

const expectBlocked = async (url: string) => {
  const err: any = await viaDispatcher(url).then(
    () => null,
    (e) => e
  );
  expect(err).toBeTruthy();
  expect(String(err.cause?.message ?? err.message)).toContain('Blocked IP');
};

describe('ssrfSafeDispatcher', () => {
  it('refuses an IPv4 loopback literal', async () => {
    await expectBlocked(`http://127.0.0.1:${v4Port}/`);
  });

  it('refuses an IPv4-mapped IPv6 literal', async () => {
    await expectBlocked(`http://[::ffff:127.0.0.1]:${v4Port}/`);
  });

  it('refuses the metadata IP literal', async () => {
    await expectBlocked('http://169.254.169.254/latest/meta-data');
  });

  it('refuses a decimal IPv4 spelling', async () => {
    await expectBlocked(`http://2130706433:${v4Port}/`);
  });

  it('refuses the IPv6 loopback literal', async () => {
    if (!v6Port) return; // IPv6 loopback unavailable: nothing to test
    await expectBlocked(`http://[::1]:${v6Port}/`);
  });

  it('refuses localhost (resolved through the lookup hook)', async () => {
    await expectBlocked(`http://localhost:${v4Port}/`);
  });

  it('refuses a public-looking hostname that resolves to loopback', async () => {
    jest.spyOn(dns, 'lookup').mockImplementation(((
      _h: string,
      opts: any,
      cb: any
    ) => {
      const done = typeof opts === 'function' ? opts : cb;
      if (opts && opts.all) {
        return done(null, [{ address: '127.0.0.1', family: 4 }]);
      }
      done(null, '127.0.0.1', 4);
    }) as any);
    await expectBlocked(`http://rebind.example:${v4Port}/`);
  });

  it('refuses a redirect hop to loopback (fetch follows through the same agent)', async () => {
    // Start on a hostname the guard accepts, then 302 to 127.0.0.1. The
    // second hop is a fresh connection through guardedConnector.
    jest.spyOn(dns, 'lookup').mockImplementation(((
      _h: string,
      opts: any,
      cb: any
    ) => {
      const done = typeof opts === 'function' ? opts : cb;
      if (opts && opts.all) {
        return done(null, [{ address: '93.184.216.34', family: 4 }]);
      }
      done(null, '93.184.216.34', 4);
    }) as any);
    const realConnect = net.connect;
    jest.spyOn(net, 'connect').mockImplementation(((options: any) => {
      // The guard approved 93.184.216.34; reach our local server instead so
      // the test never leaves the machine.
      if (options && options.lookup) {
        const lookup = options.lookup;
        options = {
          ...options,
          lookup: (h: string, o: any, cb: any) =>
            lookup(h, o, (err: any, addr: any, fam: any) => {
              if (err) return cb(err);
              if (Array.isArray(addr)) {
                return cb(null, [{ address: '127.0.0.1', family: 4 }]);
              }
              cb(null, '127.0.0.1', 4);
            }),
        };
      }
      return realConnect(options);
    }) as any);

    await expectBlocked(`http://public.example:${v4Port}/redirect`);
  });

  it('lets a hostname that resolves to a public IP connect', async () => {
    const lookupSpy = jest.spyOn(dns, 'lookup').mockImplementation(((
      _h: string,
      opts: any,
      cb: any
    ) => {
      const done = typeof opts === 'function' ? opts : cb;
      if (opts && opts.all) {
        return done(null, [{ address: '93.184.216.34', family: 4 }]);
      }
      done(null, '93.184.216.34', 4);
    }) as any);
    const realConnect = net.connect;
    jest.spyOn(net, 'connect').mockImplementation(((options: any) => {
      const lookup = options.lookup;
      return realConnect({
        ...options,
        lookup: (h: string, o: any, cb: any) =>
          lookup(h, o, (err: any, addr: any) => {
            if (err) return cb(err);
            // Approved by the guard; redirect the socket to the local server.
            if (Array.isArray(addr)) {
              return cb(null, [{ address: '127.0.0.1', family: 4 }]);
            }
            cb(null, '127.0.0.1', 4);
          }),
      });
    }) as any);

    // A fresh agent so no pooled socket from another test is reused.
    const agent = new Agent({ connect: guardedConnector });
    const res = await viaDispatcher(`http://public.example:${v4Port}/`, agent);
    expect(await res.text()).toBe('reached');
    expect(lookupSpy).toHaveBeenCalled();
    await agent.close();
  });
});

describe('guardedLookup', () => {
  const run = (answer: any, all = false) =>
    new Promise<{ err: any; address: any }>((resolve) => {
      jest.spyOn(dns, 'lookup').mockImplementation(((
        _h: string,
        _o: any,
        cb: any
      ) => cb(null, answer, 4)) as any);
      guardedLookup('host.example', { all } as any, (err: any, address: any) =>
        resolve({ err, address })
      );
    });

  it('passes a public answer through unchanged', async () => {
    const { err, address } = await run('93.184.216.34');
    expect(err).toBeNull();
    expect(address).toBe('93.184.216.34');
  });

  it('refuses when any record in an all-answer is private', async () => {
    const { err } = await run(
      [
        { address: '93.184.216.34', family: 4 },
        { address: '::ffff:7f00:1', family: 6 },
      ],
      true
    );
    expect(err?.message).toBe('Blocked IP');
  });
});
