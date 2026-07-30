import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class MediaListTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'mediaList';

  run() {
    return createTool({
      id: 'mediaList',
      description: `List the images and videos already in the media library, newest first, 18 per page.
Use it to reuse an existing asset in a post (pass its "path" as the attachment) or to find the id of an asset the user wants deleted.`,
      mcp: {
        annotations: {
          title: 'List Media',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        page: z
          .number()
          .optional()
          .describe('Page number, starting at 1 (defaults to 1)'),
        search: z
          .string()
          .optional()
          .describe('Optional text to search in the original file name'),
      }),
      outputSchema: z.object({
        pages: z.number().optional(),
        media: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().nullable(),
              originalName: z.string().nullable(),
              path: z.string(),
              alt: z.string().nullable(),
            })
          )
          .optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const { pages, results } = await this._mediaService.getMedia(
            organizationId,
            inputData.page || 1,
            inputData.search
          );

          return {
            pages,
            media: (results || []).map((media: any) => ({
              id: media.id,
              name: media.name ?? null,
              originalName: media.originalName ?? null,
              path: media.path,
              alt: media.alt ?? null,
            })),
          };
        } catch (err) {
          return {
            error: `Failed to list media: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
