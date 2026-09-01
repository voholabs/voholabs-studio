import { MCPClient } from '@mastra/mcp';
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
 * Opens a connection to the meter as the organization, runs `fn`, and always
 * closes it again. A fresh client per call, exactly like the Sanity proxy:
 * `MCPClient` caches by id and refuses two live instances with the same
 * configuration, and a long-lived per-org client would keep an authenticated
 * session open for every customer who has ever asked a question. The id is
 * random plus nothing sensitive - never the key.
 */
export const withMediaMeterMcp = async <T>(
  key: string,
  fn: (tools: Record<string, any>) => Promise<T>
): Promise<T> => {
  const client = new MCPClient({
    id: `media-meter-${makeId(10)}`,
    servers: {
      mediaMeter: {
        url: new URL(`${mediaMeterUrl()}/mcp/${key}`),
      },
    },
    // Media generation kicks off jobs and returns; 60s covers the slowest
    // synchronous calls (imports, catalog) without holding a worker forever.
    timeout: 60000,
  });

  try {
    const toolsets = await client.listToolsets();
    return await fn(toolsets['mediaMeter'] || {});
  } finally {
    await client.disconnect().catch(() => {
      // A failed disconnect is not the caller's problem and must not mask the
      // real result or the real error.
    });
  }
};
