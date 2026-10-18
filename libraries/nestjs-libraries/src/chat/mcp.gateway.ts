import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

// The header the MCP gateway sends, with MCP_GATEWAY_SECRET (set on both
// services), on the calls it makes for its own tools.
export const MCP_GATEWAY_HEADER = 'x-mcp-gateway-secret';

// Whether the request comes from the MCP gateway. Without MCP_GATEWAY_SECRET
// nothing does.
export const fromGateway = (req: Pick<Request, 'headers'>) => {
  const secret = process.env.MCP_GATEWAY_SECRET || '';
  const sent = req.headers[MCP_GATEWAY_HEADER];
  if (!secret || typeof sent !== 'string') {
    return false;
  }
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};
