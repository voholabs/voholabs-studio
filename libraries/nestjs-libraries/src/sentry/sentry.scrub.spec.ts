import {
  REDACTED,
  redactBreadcrumb,
  redactEvent,
  redactLog,
  redactUrl,
} from '@gitroom/nestjs-libraries/sentry/sentry.scrub';

describe('redactUrl', () => {
  it('redacts the API key path segment of the MCP and SSE transports', () => {
    expect(redactUrl('https://x.com/api/mcp/abc123')).toBe(
      `https://x.com/api/mcp/${REDACTED}`
    );
    expect(redactUrl('/sse/abc123?x=1')).toBe(`/sse/${REDACTED}?x=1`);
    expect(redactUrl('POST /message/abc123/')).toBe(
      `POST /message/${REDACTED}/`
    );
  });

  it('leaves the OAuth MCP endpoint and other paths alone', () => {
    expect(redactUrl('/mcp-oauth')).toBe('/mcp-oauth');
    expect(redactUrl('/mcp')).toBe('/mcp');
    expect(redactUrl('/posts/abc?page=2')).toBe('/posts/abc?page=2');
  });

  it('redacts credential query values', () => {
    expect(
      redactUrl('/provider/x?loggedAuth=eyJ.a.b&lang=en&code=c1&state=s1')
    ).toBe(
      `/provider/x?loggedAuth=${REDACTED}&lang=en&code=${REDACTED}&state=${REDACTED}`
    );
    expect(redactUrl('/a?token=t#frag')).toBe(`/a?token=${REDACTED}#frag`);
  });

  it('passes non-strings through', () => {
    expect(redactUrl(undefined)).toBeUndefined();
    expect(redactUrl(5 as any)).toBe(5);
  });
});

describe('redactEvent', () => {
  it('scrubs the request', () => {
    const event: any = redactEvent({
      request: {
        url: 'https://x.com/api/auth/login?code=abc',
        query_string: 'code=abc&next=1',
        headers: {
          Authorization: 'Bearer k',
          auth: 'jwt',
          Cookie: 'auth=jwt',
          impersonate: 'u',
          'user-agent': 'ua',
        },
        cookies: { auth: 'jwt' },
        data: { email: 'a@b.c', password: 'p' },
      },
    });

    expect(event.request).toEqual({
      url: `https://x.com/api/auth/login?code=${REDACTED}`,
      query_string: `code=${REDACTED}&next=1`,
      headers: {
        Authorization: REDACTED,
        auth: REDACTED,
        Cookie: REDACTED,
        impersonate: REDACTED,
        'user-agent': 'ua',
      },
      cookies: REDACTED,
      data: REDACTED,
    });
  });

  it('drops bodies on social-connect and provisioning, keeps others', () => {
    const connect: any = redactEvent({
      request: { url: '/integrations/social-connect/x', data: { code: 1 } },
    });
    const provision: any = redactEvent({
      request: { url: '/public/provision', data: { secret: 1 } },
    });
    const posts: any = redactEvent({
      request: { url: '/posts', data: { content: 'hi' } },
    });

    expect(connect.request.data).toBe(REDACTED);
    expect(provision.request.data).toBe(REDACTED);
    expect(posts.request.data).toEqual({ content: 'hi' });
  });

  it('handles query strings given as pairs or objects', () => {
    const pairs: any = redactEvent({
      request: {
        query_string: [
          ['token', 't'],
          ['page', '1'],
        ],
      },
    });
    const object: any = redactEvent({
      request: { query_string: { loggedAuth: 'j', page: '1' } },
    });

    expect(pairs.request.query_string).toEqual([
      ['token', REDACTED],
      ['page', '1'],
    ]);
    expect(object.request.query_string).toEqual({
      loggedAuth: REDACTED,
      page: '1',
    });
  });

  it('scrubs transactions, spans, breadcrumbs and exception messages', () => {
    const event: any = redactEvent({
      transaction: 'POST /mcp/key1',
      exception: { values: [{ value: 'failed GET /sse/key2' }] },
      breadcrumbs: [{ message: '/message/key3', data: { url: '/mcp/key4' } }],
      contexts: { trace: { data: { 'http.target': '/mcp/key5' } } },
      spans: [
        { description: 'GET /sse/key6', data: { 'url.full': '/mcp/key7' } },
      ],
    });

    expect(JSON.stringify(event)).not.toMatch(/key\d/);
  });
});

describe('redactBreadcrumb and redactLog', () => {
  it('scrubs breadcrumb urls', () => {
    expect(
      redactBreadcrumb({ category: 'http', data: { url: '/mcp/k?token=t' } })
    ).toEqual({
      category: 'http',
      data: { url: `/mcp/${REDACTED}?token=${REDACTED}` },
    });
  });

  it('scrubs log messages and attributes', () => {
    expect(
      redactLog({
        level: 'error',
        message: 'bad /mcp/k',
        attributes: { path: '/sse/k' },
      })
    ).toEqual({
      level: 'error',
      message: `bad /mcp/${REDACTED}`,
      attributes: { path: `/sse/${REDACTED}` },
    });
  });
});
