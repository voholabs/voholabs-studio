import {
  clientFromInfoName,
  clientFromUserAgent,
  readMcpBody,
} from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent.client';

describe('agent client parsing', () => {
  it('maps known clientInfo names to one family', () => {
    expect(clientFromInfoName('claude-ai')).toBe('claude');
    expect(clientFromInfoName('Claude Desktop')).toBe('claude');
    expect(clientFromInfoName('claude-code')).toBe('claude-code');
    expect(clientFromInfoName('openai-mcp')).toBe('chatgpt');
    expect(clientFromInfoName('ChatGPT')).toBe('chatgpt');
    expect(clientFromInfoName('codex-mcp-client')).toBe('codex');
    expect(clientFromInfoName('cursor-vscode')).toBe('cursor');
    expect(clientFromInfoName('Visual Studio Code')).toBe('vscode');
    expect(clientFromInfoName('n8n-mcp-client')).toBe('n8n');
  });

  it('keeps an unknown clientInfo name, sanitised and cut short', () => {
    expect(clientFromInfoName('My Agent/1.0 <script>')).toBe(
      'my-agent-1.0-script'
    );
    expect(clientFromInfoName('x'.repeat(100))).toHaveLength(40);
  });

  it('ignores a missing or empty clientInfo name', () => {
    expect(clientFromInfoName(undefined)).toBeUndefined();
    expect(clientFromInfoName('   ')).toBeUndefined();
    expect(clientFromInfoName(42)).toBeUndefined();
    expect(clientFromInfoName('!!!')).toBeUndefined();
  });

  it('reads the User-Agent family, else other', () => {
    expect(clientFromUserAgent('claude-code/2.1.0 (cli)')).toBe('claude-code');
    expect(clientFromUserAgent('Claude-User')).toBe('claude');
    expect(clientFromUserAgent('openai-mcp/1.0.0')).toBe('chatgpt');
    expect(clientFromUserAgent('Cursor/1.2')).toBe('cursor');
    expect(clientFromUserAgent('node')).toBe('other');
    expect(clientFromUserAgent(undefined)).toBe('other');
  });

  it('reads initialize and tools/call from a body or a batch, never arguments', () => {
    expect(
      readMcpBody({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { clientInfo: { name: 'claude-ai', version: '0.1' } },
      })
    ).toEqual({ clientInfoName: 'claude-ai' });
    const out = readMcpBody([
      {
        method: 'tools/call',
        params: { name: 'integrationList', arguments: { secret: 'x' } },
      },
    ]);
    expect(out).toEqual({ toolName: 'integrationList' });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(readMcpBody(undefined)).toEqual({});
    expect(readMcpBody('not json')).toEqual({});
    expect(readMcpBody([null, 1])).toEqual({});
  });
});
