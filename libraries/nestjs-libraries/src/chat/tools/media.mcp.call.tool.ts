import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaMeterService } from '@gitroom/nestjs-libraries/database/prisma/media-meter/media-meter.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  MEDIA_MCP_NOT_CONFIGURED,
  MEDIA_MCP_UNAVAILABLE,
  scrubMeterKey,
  withMediaMeterMcp,
} from '@gitroom/nestjs-libraries/chat/tools/media.mcp.shared';
import { organizationIdFromContext } from '@gitroom/nestjs-libraries/chat/tools/sanity.mcp.shared';

@Injectable()
export class MediaMcpCallTool implements AgentToolInterface {
  constructor(private _mediaMeterService: MediaMeterService) {}
  name = 'mediaMcpCall';

  run() {
    return createTool({
      id: 'mediaMcpCall',
      description: `Runs one of the AI media tools listed by mediaMcpList - generate or edit images and videos, import media by URL, discover models, poll jobs, check remaining_budget. Pass the tool name exactly as mediaMcpList reported it and an arguments object matching the inputSchema it reported; call mediaMcpList first if you have not this conversation, and follow the rules in each tool's own description (media must be imported with media_import_url before a generation can reference it - a URL is not a valid medias[].value).
      For "change the image on my post": postsList to find the post and its image URL, media_import_url to import that URL, generate the edit with the model models_explore recommends, job_status until the job finishes, then uploadFromUrlTool on the result URL and replacePostAsset to swap it onto the post - after showing the user the replacement and getting their explicit approval.
      Generations spend the workspace's shared credit allowance. If a call reports the allowance is used up, relay that message to the user as-is - it explains the situation in their terms.`,
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
          return await withMediaMeterMcp(resolution.key, async (tools) => {
            const tool = tools[inputData.name];

            if (!tool?.execute) {
              return {
                output: `The AI media service does not expose a tool called "${inputData.name}". Call mediaMcpList for the current list.`,
              };
            }

            // An out-of-credit call comes back as a normal tool result with
            // isError and text written for a person - it passes through here
            // untouched, like every other result.
            const output = await tool.execute(inputData.arguments || {}, {});

            return { output };
          });
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
