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
import {
  organizationIdFromContext,
  readJsonSchema,
} from '@gitroom/nestjs-libraries/chat/tools/sanity.mcp.shared';

@Injectable()
export class MediaMcpListTool implements AgentToolInterface {
  constructor(private _mediaMeterService: MediaMeterService) {}
  name = 'mediaMcpList';

  run() {
    return createTool({
      id: 'mediaMcpList',
      description: `Lists the AI media-editing and generation tools available to this workspace - image and video generation, editing an existing image, upscaling, background removal, reframing, model discovery (models_explore), importing media by URL (media_import_url), job polling (job_status), and remaining_budget for the workspace's shared credit allowance - with the exact arguments each one takes.
      This is where "change the image on my post", "generate an image/video for this post" or any other AI media work starts: call this first, read the returned descriptions carefully (they carry rules that are not repeated anywhere else - for example, media must be imported with media_import_url before it can be referenced in a generation; a raw URL cannot be passed as medias[].value), then run tools with mediaMcpCall.
      To edit an image already on a post: find it with postsList, import its URL with media_import_url, generate the edit (discover the right model with models_explore if unsure), poll the job with job_status until it finishes, bring the result into the media library with uploadFromUrlTool, and apply it with replacePostAsset - which requires showing the user the replacement and getting their explicit approval first.
      Generations spend the workspace's shared credit; check remaining_budget when in doubt. No setup or key is needed - this is part of Studio.`,
      mcp: {
        annotations: {
          title: 'List AI Media Tools',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        output: z.union([
          z.string(),
          z.object({
            tools: z.array(
              z.object({
                name: z.string(),
                description: z.string(),
                inputSchema: z
                  .any()
                  .describe(
                    'JSON Schema for the `arguments` object to pass to mediaMcpCall'
                  ),
              })
            ),
          }),
        ]),
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
          return await withMediaMeterMcp(resolution.key, async (tools) => ({
            output: {
              // The upstream's names, descriptions and schemas pass through
              // intact: discovery is the whole point, and the vendor's own
              // descriptions carry usage rules the agent needs verbatim.
              tools: Object.entries(tools).map(([name, tool]) => ({
                name,
                description: (tool as any)?.description || '',
                inputSchema: readJsonSchema((tool as any)?.inputSchema),
              })),
            },
          }));
        } catch (err) {
          // The key itself is never in the message, and never logged.
          return {
            output: `Could not reach the AI media service: ${scrubMeterKey(
              err instanceof Error ? err.message : 'unexpected error',
              resolution.key
            )}`,
          };
        }
      },
    });
  }
}
