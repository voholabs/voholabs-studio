import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaMeterService } from '@gitroom/nestjs-libraries/database/prisma/media-meter/media-meter.service';
import {
  checkAuth,
  paidOnly,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  MEDIA_MCP_NOT_CONFIGURED,
  MEDIA_MCP_UNAVAILABLE,
  callMediaTool,
  scrubMeterKey,
} from '@gitroom/nestjs-libraries/chat/tools/media.mcp.shared';
import { organizationIdFromContext } from '@gitroom/nestjs-libraries/chat/tools/sanity.mcp.shared';

@Injectable()
export class MediaMcpCallTool implements AgentToolInterface {
  constructor(private _mediaMeterService: MediaMeterService) {}
  name = 'mediaMcpCall';

  run() {
    return createTool({
      id: 'mediaMcpCall',
      description: `Runs one of the AI media tools listed by mediaMcpList - generate or edit images and videos, import media by URL, discover models, poll jobs, check remaining_budget. "name" is the tool name exactly as mediaMcpList reported it and "arguments" matches the inputSchema it reported. Each tool's own description carries its rules; for example a generation references media imported with media_import_url, since a plain URL is not a valid medias[].value.
      "Change the image on my post" runs as: postsList for the post and its image URL, media_import_url on that URL, the edit generated with the model models_explore recommends, job_status until the job finishes, then uploadFromUrlTool on the result URL and replacePostAsset, which swaps it onto the post once the user has seen and approved the replacement.
      Generations spend the workspace's shared credit allowance. When it is used up, the call returns a message that explains the situation in the user's terms.`,
      mcp: {
        annotations: {
          title: 'Call AI Media Tool',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            'The media tool name, exactly as mediaMcpList reported it'
          ),
        arguments: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Arguments for the tool, matching the inputSchema from mediaMcpList'
          ),
      }),
      outputSchema: z.object({
        output: z.any(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        // Before the key is resolved: resolving mints a metered key, and a
        // free organization must not get one.
        const blocked = paidOnly(context, 'AI media generation');
        if (blocked) {
          return { output: blocked };
        }
        const organizationId = organizationIdFromContext(context);

        const resolution =
          await this._mediaMeterService.resolveKey(organizationId);

        if (resolution.state === 'not_configured') {
          return { output: MEDIA_MCP_NOT_CONFIGURED };
        }
        if (resolution.state === 'unavailable') {
          return { output: MEDIA_MCP_UNAVAILABLE };
        }

        try {
          // An out-of-credit call comes back as a normal tool result with
          // isError and text written for a person - it passes through here
          // untouched, like every other result.
          const output = await callMediaTool(
            resolution.key,
            inputData.name,
            inputData.arguments || {}
          );

          return { output };
        } catch (err) {
          // The key itself is never in the message, and never logged.
          return {
            output: `The AI media service refused the call: ${scrubMeterKey(
              err instanceof Error ? err.message : 'unexpected error',
              resolution.key
            )}`,
          };
        }
      },
    });
  }
}
