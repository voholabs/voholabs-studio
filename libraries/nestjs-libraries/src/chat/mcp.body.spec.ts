import { Readable } from 'stream';
import { bufferJsonBody } from '@gitroom/nestjs-libraries/chat/mcp.body';

const request = (method: string, text?: string) => {
  const req: any = Readable.from(text === undefined ? [] : [Buffer.from(text)]);
  req.method = method;
  return req;
};

const response = () => {
  const res: any = { headersSent: false };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('bufferJsonBody', () => {
  it('leaves the parsed body on req.body for Mastra', async () => {
    const req = request(
      'POST',
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
    );
    const res = response();
    expect(await bufferJsonBody(req, res)).toBe(true);
    expect(req.body).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not touch a GET or an already parsed body', async () => {
    const get = request('GET');
    expect(await bufferJsonBody(get, response())).toBe(true);
    expect(get.body).toBeUndefined();
    const parsed = request('POST', 'ignored');
    parsed.body = { method: 'tools/list' };
    expect(await bufferJsonBody(parsed, response())).toBe(true);
    expect(parsed.body).toEqual({ method: 'tools/list' });
  });

  it('answers invalid JSON with a JSON-RPC parse error', async () => {
    const res = response();
    expect(await bufferJsonBody(request('POST', '{nope'), res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe(-32700);
  });
});
