import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class UploadWidgetStatusTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'uploadWidgetStatusTool';

  run() {
    return createTool({
      id: 'uploadWidgetStatusTool',
      description: `List the media the user uploaded with the upload box, using the sessionId returned by uploadWidgetTool.
An empty list means nothing has finished uploading yet: a large video can take a few minutes, so ask the user or call again later.
Each item can be attached to a post with its { id, path }.`,
      mcp: {
        annotations: {
          title: 'Upload Box Status',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        sessionId: z
          .string()
          .describe('The sessionId returned by uploadWidgetTool'),
      }),
      outputSchema: z.object({
        media: z
          .array(
            z.object({
              id: z.string(),
              path: z.string(),
              name: z.string().optional(),
            })
          )
          .optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const org = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );
          const media = await this._mediaService.getUploadSession(
            org.id,
            inputData.sessionId
          );
          return {
            media: media.map((p: any) => ({
              id: p.id,
              path: p.path,
              name: p.originalName || p.name || undefined,
            })),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Upload session lookup failed: ${message}` };
        }
      },
    });
  }
}
