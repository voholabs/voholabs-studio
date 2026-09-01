import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

/**
 * Studio proxies an AI media-editing MCP (Higgsfield's catalog, behind the
 * mcp-meter service that meters spend per organization). Same shape as the
 * Sanity proxy next door - a list tool and a call tool rather than ~45
 * statically registered ones - because the upstream catalog is the vendor's to
 * change and the boot-time tool map here is fixed.
 *
 * Unlike the Sanity proxy there is no allowlist here: the meter itself already
 * denies dangerous and cross-user tools, and it is the authority on its own
 * catalog. Filtering again in Studio would mean every safe tool the meter adds
 * stays invisible until someone edits this file.
 *
 * The credential is the org's meter key. It rides in the URL path, so it must
 * never appear in logs, tool output, or error text - see scrubMeterKey.
 */

export const MEDIA_MCP_NOT_CONFIGURED =
  'AI media editing is not set up on this deployment (the media service is not configured), ' +
  'so these tools cannot run. There is nothing the user can do from their side; ' +
  'the deployment operator has to configure it.';

export const MEDIA_MCP_UNAVAILABLE =
  'The AI media service could not be reached right now. Nothing was charged. ' +
  'Try again in a moment; if it keeps failing, tell the user the media service is temporarily down.';

export const mediaMeterUrl = () =>
  (process.env.MCP_METER_URL || '').replace(/\/+$/, '');

/**
 * The key is a path segment of the upstream URL, and library errors love to
 * quote URLs. Everything that might carry an error message back to the agent
 * goes through here first.
 */
export const scrubMeterKey = (text: string, key: string) =>
  text.split(key).join('[meter-key]');

/**
 * Talks to the meter as raw JSON-RPC rather than through an MCP client
 * library.
 *
 * The library validates arguments against the upstream's own inputSchema
 * before sending them, and those schemas declare JSON Schema draft 2020-12,
 * which its validator cannot resolve - so every tool that takes an argument
 * failed with "no schema with key or ref" before the call ever left Studio,
 * while argument-less ones worked. Validating here bought nothing anyway: the
 * meter and the vendor behind it both validate, and they are the ones whose
 * schemas these are.
 *
 * Responses arrive as an SSE stream (`data:` lines), which is why the body is
 * scanned rather than parsed whole.
 */
const rpc = async (
  key: string,
  method: string,
  params: Record<string, unknown>
): Promise<any> => {
  const id = makeId(10);
  const response = await fetch(`${mediaMeterUrl()}/mcp/${key}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(60000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`media service returned ${response.status}`);
  }

  // An SSE body opens with `event: message`, not with the data line, so sniff
  // for data lines anywhere rather than at the very start; fall back to
  // treating the whole body as one JSON document.
  const dataLines = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  const frames = dataLines.length ? dataLines : [text];

  for (const frame of frames) {
    let parsed: any;
    try {
      parsed = JSON.parse(frame);
    } catch {
      continue;
    }
    if (parsed?.id !== id) continue;
    if (parsed.error) {
      throw new Error(
        typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : 'media service rejected the request'
      );
    }
    return parsed.result;
  }

  throw new Error('media service returned no usable response');
};

/** The upstream catalog, with every tool's schema exactly as the vendor wrote it. */
export const listMediaTools = async (key: string): Promise<any[]> => {
  const result = await rpc(key, 'tools/list', {});
  return Array.isArray(result?.tools) ? result.tools : [];
};

/** Runs one upstream tool. Arguments are passed through untouched. */
export const callMediaTool = async (
  key: string,
  name: string,
  args: Record<string, unknown>
): Promise<any> => rpc(key, 'tools/call', { name, arguments: args });
