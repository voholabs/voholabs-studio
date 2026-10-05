import { AgentConnectionRecorder } from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.recorder';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const setup = (
  write: jest.Mock = jest.fn().mockResolvedValue({ first: false }),
  afterWrite: jest.Mock = jest.fn()
) => {
  let now = 1_000_000;
  const recorder = new AgentConnectionRecorder(write, afterWrite, {
    throttleMs: 5 * 60 * 1000,
    now: () => now,
  });
  return {
    recorder,
    write,
    afterWrite,
    advance: (ms: number) => (now += ms),
  };
};

const init = (name: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { clientInfo: { name } },
});

describe('AgentConnectionRecorder', () => {
  it('records the first request at once', async () => {
    const { recorder, write, afterWrite } = setup(
      jest.fn().mockResolvedValue({ first: true })
    );
    recorder.seen({
      organizationId: 'org1',
      authMethod: 'API_KEY',
      userAgent: 'node',
      body: init('claude-ai'),
    });
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({
      organizationId: 'org1',
      client: 'claude',
      authMethod: 'API_KEY',
      requests: 1,
    });
    expect(afterWrite).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'claude' }),
      { first: true }
    );
  });

  it('writes at most once per org, client and method every 5 minutes, keeping the count', async () => {
    const { recorder, write, advance } = setup();
    const seen = (body?: unknown) =>
      recorder.seen({
        organizationId: 'org1',
        authMethod: 'OAUTH',
        userAgent: 'Claude-User',
        body,
      });
    seen();
    seen({ method: 'tools/call', params: { name: 'postsList' } });
    seen();
    await flush();
    expect(write).toHaveBeenCalledTimes(1);

    advance(4 * 60 * 1000);
    seen();
    await flush();
    expect(write).toHaveBeenCalledTimes(1);

    advance(60 * 1000);
    seen();
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toMatchObject({
      client: 'claude',
      authMethod: 'OAUTH',
      requests: 4,
      toolName: 'postsList',
    });
  });

  it('throttles each client and sign-in method on its own', async () => {
    const { recorder, write } = setup();
    recorder.seen({
      organizationId: 'org1',
      authMethod: 'API_KEY',
      userAgent: 'Cursor/1',
    });
    recorder.seen({
      organizationId: 'org1',
      authMethod: 'OAUTH',
      userAgent: 'Cursor/1',
    });
    recorder.seen({
      organizationId: 'org1',
      authMethod: 'API_KEY',
      userAgent: 'claude-code/2',
    });
    recorder.seen({
      organizationId: 'org2',
      authMethod: 'API_KEY',
      userAgent: 'Cursor/1',
    });
    await flush();
    expect(write).toHaveBeenCalledTimes(4);
  });

  it('counts requests after initialize under the client it named', async () => {
    const { recorder, write, advance } = setup();
    recorder.seen({
      organizationId: 'org1',
      authMethod: 'API_KEY',
      userAgent: 'python-httpx',
      body: init('My Bot'),
    });
    advance(6 * 60 * 1000);
    recorder.seen({
      organizationId: 'org1',
      authMethod: 'API_KEY',
      userAgent: 'python-httpx',
      body: { method: 'tools/list' },
    });
    await flush();
    expect(write.mock.calls.map((c) => c[0].client)).toEqual([
      'my-bot',
      'my-bot',
    ]);
  });

  it('falls back to other without a clientInfo or a known User-Agent', async () => {
    const { recorder, write } = setup();
    recorder.seen({ organizationId: 'org1', authMethod: 'API_KEY' });
    await flush();
    expect(write.mock.calls[0][0].client).toBe('other');
  });

  it('never throws into the request', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('db down'));
    const throwing = jest.fn(() => {
      throw new Error('sync boom');
    });
    const badFollowUp = jest.fn().mockRejectedValue(new Error('redis down'));
    for (const [write, after] of [
      [failing, jest.fn()],
      [throwing, jest.fn()],
      [jest.fn().mockResolvedValue({ first: true }), badFollowUp],
    ] as Array<[jest.Mock, jest.Mock]>) {
      const recorder = new AgentConnectionRecorder(write, after);
      expect(() =>
        recorder.seen({
          organizationId: 'org1',
          authMethod: 'API_KEY',
          body: {
            method: 'initialize',
            params: { clientInfo: { name: { evil: true } } },
          },
        })
      ).not.toThrow();
    }
    await flush();
    expect(failing).toHaveBeenCalled();
    expect(throwing).toHaveBeenCalled();
    expect(badFollowUp).toHaveBeenCalled();
  });

  it('returns before the write finishes', () => {
    const write = jest.fn(
      () => new Promise<{ first: boolean }>(() => undefined)
    );
    const recorder = new AgentConnectionRecorder(write);
    const result = recorder.seen({
      organizationId: 'org1',
      authMethod: 'API_KEY',
    });
    expect(result).toBeUndefined();
  });

  it('keeps the count of a failed write for the next one', async () => {
    const write = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ first: false });
    const { recorder, advance } = setup(write);
    recorder.seen({ organizationId: 'org1', authMethod: 'API_KEY' });
    recorder.seen({ organizationId: 'org1', authMethod: 'API_KEY' });
    await flush();
    advance(5 * 60 * 1000);
    recorder.seen({ organizationId: 'org1', authMethod: 'API_KEY' });
    await flush();
    expect(write.mock.calls[1][0].requests).toBe(3);
  });

  it('ignores a request without an organization', async () => {
    const { recorder, write } = setup();
    recorder.seen({ organizationId: '', authMethod: 'API_KEY' });
    await flush();
    expect(write).not.toHaveBeenCalled();
  });
});
