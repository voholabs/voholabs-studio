import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  safeFetch,
  safeFetchBuffer,
  safeFetchStream,
  SafeFetchError,
} from './safe.fetch';
import { ssrfSafeDispatcher } from './ssrf.safe.dispatcher';

// The mechanics (timeout, caps, redirects) are exercised against a loopback
// server with DISABLE_SSRF_PROTECTION=true, the self-host opt-out, because
// with the guard on loopback is refused, which is checked separately below.

let server: http.Server;
let base: string;
const seen: Array<{ method: string; url: string; body: string; ct?: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        body,
        ct: req.headers['content-type'] as string,
      });
      switch (req.url) {
        case '/html':
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return res.end('<p>hi</p>');
        case '/json':
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end('{}');
        case '/big': {
          res.writeHead(200, { 'content-type': 'text/plain' });
          // No content-length: the cap must trigger while streaming.
          const chunk = Buffer.alloc(64 * 1024, 97);
          let sent = 0;
          const pump = () => {
            while (sent < 20 && res.write(chunk)) sent++;
            if (sent < 20) res.once('drain', pump);
            else res.end();
          };
          return pump();
        }
        case '/declared-big':
          res.writeHead(200, {
            'content-type': 'text/plain',
            'content-length': String(10 * 1024 * 1024),
          });
          return res.end();
        case '/slow':
          return setTimeout(() => res.end('late'), 600).unref();
        case '/r307':
          res.writeHead(307, { location: '/echo' });
          return res.end();
        case '/r302':
          res.writeHead(302, { location: '/echo' });
          return res.end();
        case '/loop':
          res.writeHead(302, { location: '/loop' });
          return res.end();
        case '/sized':
          res.writeHead(200, {
            'content-type': 'video/mp4',
            'content-length': '5',
          });
          return res.end('bytes');
        case '/missing':
          res.writeHead(404, { 'content-type': 'text/plain' });
          return res.end('nope');
        case '/to-file':
          res.writeHead(302, { location: 'file:///etc/passwd' });
          return res.end();
        default:
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end('ok');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await ssrfSafeDispatcher.close().catch(() => undefined);
});

const statusOf = (p: Promise<any>) =>
  p.then(
    () => 'resolved',
    (e) => (e instanceof SafeFetchError ? e.status : `other:${e?.message}`)
  );

describe('safeFetch with the guard on', () => {
  beforeEach(() => delete process.env.DISABLE_SSRF_PROTECTION);

  it('refuses loopback, mapped and decimal forms before connecting', async () => {
    for (const url of [
      `${base}/`,
      'https://[::ffff:7f00:1]/',
      'https://2130706433/',
      'https://localhost/',
    ]) {
      expect(await statusOf(safeFetch(url, {}, { allowHttp: true }))).toBe(400);
    }
  });

  it('refuses http unless allowed', async () => {
    expect(await statusOf(safeFetch('http://example.com/'))).toBe(400);
  });

  it('keeps the guard on when ignoreOptOut is set, whatever the env says', async () => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    expect(
      await statusOf(
        safeFetch(`${base}/`, {}, { allowHttp: true, ignoreOptOut: true })
      )
    ).toBe(400);
  });
});

describe('safeFetch mechanics (self-host opt-out)', () => {
  beforeEach(() => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    seen.length = 0;
  });
  afterAll(() => delete process.env.DISABLE_SSRF_PROTECTION);

  const opts = { allowHttp: true };

  it('returns the body when the content type is allowed', async () => {
    const res = await safeFetch(`${base}/html`, {}, {
      ...opts,
      allowedContentTypes: ['text/html'],
    });
    expect(await res.text()).toBe('<p>hi</p>');
  });

  it('rejects other content types with 415', async () => {
    expect(
      await statusOf(
        safeFetch(`${base}/json`, {}, { ...opts, allowedContentTypes: ['text/'] })
      )
    ).toBe(415);
  });

  it('rejects a declared length over the cap with 413', async () => {
    expect(
      await statusOf(safeFetch(`${base}/declared-big`, {}, { ...opts, maxBytes: 1024 }))
    ).toBe(413);
  });

  it('stops reading a streamed body once it passes the cap', async () => {
    const res = await safeFetch(`${base}/big`, {}, {
      ...opts,
      maxBytes: 256 * 1024,
    });
    expect(await statusOf(res.text())).toBe(413);
  });

  it('times out', async () => {
    expect(
      await statusOf(safeFetch(`${base}/slow`, {}, { ...opts, timeoutMs: 200 }))
    ).toBe(504);
  });

  it('resends method, body and headers on 307', async () => {
    const res = await safeFetch(
      `${base}/r307`,
      {
        method: 'POST',
        body: '{"a":1}',
        headers: { 'Content-Type': 'application/json' },
      },
      opts
    );
    expect(res.status).toBe(200);
    expect(seen[1]).toEqual({
      method: 'POST',
      url: '/echo',
      body: '{"a":1}',
      ct: 'application/json',
    });
  });

  it('turns POST into GET on 302, like fetch', async () => {
    await safeFetch(`${base}/r302`, { method: 'POST', body: 'x' }, opts);
    expect(seen[1].method).toBe('GET');
    expect(seen[1].body).toBe('');
  });

  it('stops after maxRedirects', async () => {
    expect(
      await statusOf(safeFetch(`${base}/loop`, {}, { ...opts, maxRedirects: 3 }))
    ).toBe(508);
    expect(seen.length).toBe(4);
  });

  it('refuses a redirect to a non-http scheme', async () => {
    expect(await statusOf(safeFetch(`${base}/to-file`, {}, opts))).toBe(400);
  });
});

describe('media download helpers', () => {
  afterEach(() => delete process.env.DISABLE_SSRF_PROTECTION);

  it('refuse loopback media URLs with the guard on', async () => {
    delete process.env.DISABLE_SSRF_PROTECTION;
    expect(await statusOf(safeFetchBuffer(`${base}/`))).toBe(400);
    expect(await statusOf(safeFetchStream(`${base}/`))).toBe(400);
  });

  it('safeFetchBuffer returns a Buffer over http when opted out', async () => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    const out = await safeFetchBuffer(`${base}/html`);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe('<p>hi</p>');
  });

  it('safeFetchBuffer fails on a non-2xx answer', async () => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    expect(await statusOf(safeFetchBuffer(`${base}/missing`))).toBe(404);
  });

  it('safeFetchBuffer applies the size cap', async () => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    expect(
      await statusOf(safeFetchBuffer(`${base}/big`, { maxBytes: 1024 }))
    ).toBe(413);
  });

  it('safeFetchStream yields a Node stream and the declared length', async () => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    const { stream, contentLength, contentType } = await safeFetchStream(
      `${base}/sized`
    );
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe('bytes');
    expect(contentLength).toBe(5);
    expect(contentType).toBe('video/mp4');
  });

  it('safeFetchStream leaves the length unset when none is declared', async () => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    const { stream, contentLength } = await safeFetchStream(`${base}/json`);
    stream.resume();
    expect(contentLength).toBeUndefined();
  });
});
