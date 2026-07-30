import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class MediaDeleteTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'deleteMediaTool';

  run() {
    return createTool({
      id: 'deleteMediaTool',
      description: `Delete an image or a video from the media library. Use mediaList first to find the id.
Posts that were already published keep their copy of the file, but any scheduled post still pointing at this asset will lose it, so always confirm with the user before calling it.`,
      mcp: {
        annotations: {
          title: 'Delete Media',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        id: z.string().describe('The id of the media to delete (from mediaList)'),
      }),
      outputSchema: z.object({
        success: z.boolean().optional(),
        id: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          // Scoped to the organization, so an id from another org raises
          // instead of deleting — surfaced as a not-found message below.
          await this._mediaService.deleteMedia(organizationId, inputData.id);

          return { success: true, id: inputData.id };
        } catch (err) {
          return {
            error: `Could not delete media ${inputData.id}: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
