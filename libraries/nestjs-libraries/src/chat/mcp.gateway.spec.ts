import {
  fromGateway,
  MCP_GATEWAY_HEADER,
} from '@gitroom/nestjs-libraries/chat/mcp.gateway';

// Only a request carrying MCP_GATEWAY_SECRET is the gateway's.
describe('fromGateway', () => {
  const env = process.env.MCP_GATEWAY_SECRET;
  afterEach(() => {
    process.env.MCP_GATEWAY_SECRET = env;
  });
  const req = (value?: string) =>
    ({ headers: value === undefined ? {} : { [MCP_GATEWAY_HEADER]: value } } as any);

  it('is nobody without a secret configured', () => {
    delete process.env.MCP_GATEWAY_SECRET;
    expect(fromGateway(req(''))).toBe(false);
    expect(fromGateway(req('anything'))).toBe(false);
  });

  it('is the request carrying the exact secret', () => {
    process.env.MCP_GATEWAY_SECRET = 'a-long-shared-secret';
    expect(fromGateway(req('a-long-shared-secret'))).toBe(true);
    expect(fromGateway(req('a-long-shared-secreT'))).toBe(false);
    expect(fromGateway(req('short'))).toBe(false);
    expect(fromGateway(req())).toBe(false);
  });
});
