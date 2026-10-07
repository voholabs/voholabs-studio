import {
  allowedBrowserOrigins,
  isAllowedBrowserRequest,
} from './request.origin';

describe('browser origin check', () => {
  const allowed = allowedBrowserOrigins({
    FRONTEND_URL: 'https://studio.example.com',
    MAIN_URL: 'https://studio.example.com/',
  } as any);

  it('builds the allow list from the configured URLs', () => {
    expect([...allowed]).toEqual([
      'https://studio.example.com',
      'http://localhost:6274',
    ]);
  });

  it('always allows reads and header-authenticated requests', () => {
    expect(isAllowedBrowserRequest({ method: 'GET', usesCookie: true, origin: 'https://evil.example' }, allowed)).toBe(true);
    expect(isAllowedBrowserRequest({ method: 'POST', usesCookie: false, origin: 'https://evil.example' }, allowed)).toBe(true);
  });

  it('allows cookie writes from our own origin', () => {
    expect(isAllowedBrowserRequest({ method: 'POST', usesCookie: true, origin: 'https://studio.example.com' }, allowed)).toBe(true);
    expect(isAllowedBrowserRequest({ method: 'DELETE', usesCookie: true, referer: 'https://studio.example.com/settings' }, allowed)).toBe(true);
  });

  it('refuses cookie writes from another site, or an opaque origin', () => {
    expect(isAllowedBrowserRequest({ method: 'POST', usesCookie: true, origin: 'https://evil.example' }, allowed)).toBe(false);
    expect(isAllowedBrowserRequest({ method: 'PUT', usesCookie: true, referer: 'https://evil.example/x' }, allowed)).toBe(false);
    expect(isAllowedBrowserRequest({ method: 'POST', usesCookie: true, origin: 'null' }, allowed)).toBe(false);
  });

  it('allows a cookie write that names no origin at all', () => {
    expect(isAllowedBrowserRequest({ method: 'POST', usesCookie: true }, allowed)).toBe(true);
  });
});
