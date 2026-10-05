import { Request, Response } from 'express';

// Reads the JSON-RPC body once and leaves it on req.body, where Mastra takes it
// from instead of the stream (readJsonBody), so the connection recorder can see
// the method without a second read. A body that is not JSON gets the JSON-RPC
// parse error here, since the stream is spent. Returns false when it answered.
export const MAX_BODY = 50 * 1024 * 1024;
export const bufferJsonBody = async (req: Request, res: Response) => {
  if (req.method !== 'POST' || req.body !== undefined) {
    return true;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY) {
        res.status(413).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Request body too large' },
          id: null,
        });
        return false;
      }
      chunks.push(buffer);
    }
    req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return true;
  } catch {
    if (!res.headersSent) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error: Invalid JSON' },
        id: null,
      });
    }
    return false;
  }
};
