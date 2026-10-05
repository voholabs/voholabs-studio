const store = new Set<string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (key: string) => {
      if (store.has(key)) return null;
      store.add(key);
      return 'OK';
    }),
  },
}));

import { trackAgentConnection } from '@gitroom/nestjs-libraries/track/product.analytics';

const events = () =>
  (global.fetch as jest.Mock).mock.calls.map((c) => JSON.parse(c[1].body));

describe('trackAgentConnection', () => {
  beforeEach(() => {
    store.clear();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'k';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://ph.example';
    global.fetch = jest.fn().mockResolvedValue({}) as any;
  });

  const props = { client: 'claude', auth_method: 'API_KEY' };

  it('sends mcp_connected on a true first connection, with client and auth method', async () => {
    await trackAgentConnection('org1', true, props);
    expect(events().map((e) => e.event)).toEqual(['mcp_connected']);
    expect(events()[0].properties).toMatchObject(props);
  });

  it('counts an organization the old marker knew as active, not new', async () => {
    store.add('analytics:mcp:org1:seen');
    await trackAgentConnection('org1', true, props);
    expect(events().map((e) => e.event)).toEqual(['mcp_active']);
  });

  it('sends mcp_active once a day after that', async () => {
    await trackAgentConnection('org1', false, props);
    await trackAgentConnection('org1', false, props);
    expect(events().map((e) => e.event)).toEqual(['mcp_active']);
  });

  it('does nothing with analytics off', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    await trackAgentConnection('org1', true, props);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
