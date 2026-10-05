// Turns what an MCP request says about its sender into a short, stable client
// name for the AgentConnection table: the `initialize` request's
// clientInfo.name when there is one, else the User-Agent's family. Known
// agents map to one name whichever of the two they come from, so a Claude
// connector is `claude` both when it initialises and when it calls a tool.

const families: Array<[RegExp, string]> = [
  [/claude[\s_-]?code/i, 'claude-code'],
  [/claude|anthropic|cowork/i, 'claude'],
  [/codex/i, 'codex'],
  [/chatgpt|openai/i, 'chatgpt'],
  [/cursor/i, 'cursor'],
  [/windsurf|codeium/i, 'windsurf'],
  [/visual[\s_-]?studio[\s_-]?code|vscode|copilot/i, 'vscode'],
  [/cline/i, 'cline'],
  [/gemini/i, 'gemini'],
  [/n8n/i, 'n8n'],
  [/hermes/i, 'hermes'],
  [/goose/i, 'goose'],
  [/\bzed\b/i, 'zed'],
  [/inspector/i, 'inspector'],
];

const MAX_CLIENT = 40;

export const familyOf = (text?: string | null): string | undefined => {
  if (!text) {
    return undefined;
  }
  return families.find(([pattern]) => pattern.test(text))?.[1];
};

// A client the list above does not know keeps its own name, cut down to
// lowercase letters, digits, dots and dashes.
const sanitise = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_CLIENT);

export const clientFromInfoName = (name?: unknown): string | undefined => {
  if (typeof name !== 'string' || !name.trim()) {
    return undefined;
  }
  return familyOf(name) || sanitise(name) || undefined;
};

export const clientFromUserAgent = (userAgent?: string | null): string =>
  familyOf(userAgent) || 'other';

type JsonRpcMessage = {
  method?: unknown;
  params?: { clientInfo?: { name?: unknown }; name?: unknown };
};

const messagesOf = (body: unknown): JsonRpcMessage[] =>
  (Array.isArray(body) ? body : [body]).filter(
    (m): m is JsonRpcMessage => !!m && typeof m === 'object'
  );

// What the recorder needs from a JSON-RPC body (one message or a batch): the
// client an `initialize` names, and the tool a `tools/call` runs. Arguments
// are never read.
export const readMcpBody = (
  body: unknown
): { clientInfoName?: string; toolName?: string } => {
  const out: { clientInfoName?: string; toolName?: string } = {};
  for (const message of messagesOf(body)) {
    if (message.method === 'initialize') {
      const name = message.params?.clientInfo?.name;
      if (typeof name === 'string') {
        out.clientInfoName = name;
      }
    }
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (typeof name === 'string') {
        out.toolName = name.slice(0, 100);
      }
    }
  }
  return out;
};
