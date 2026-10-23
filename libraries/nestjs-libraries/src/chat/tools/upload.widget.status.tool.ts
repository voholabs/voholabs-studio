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
  mcpOnly = true;

  run() {
    return createTool({
      id: 'uploadWidgetStatusTool',
      description: `Lists the media the user uploaded with the upload box, using the sessionId returned by uploadWidgetTool.
It lists only the files uploaded in that session, not the whole media library. A media id returned by uploadFromUrlTool or the public API is followed with mediaStatusTool.
An empty list means nothing has finished uploading yet: a large video can take a few minutes.
A media with the status "processing" is still being prepared, which takes about 10 seconds.
A media with the status "ready" (or no status) can be attached to a post with its { id, path }. "ready" with a warning means the adjustment failed and the original file was kept and will be used for publishing.`,
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
              status: z.string().optional(),
              warning: z.string().optional(),
              error: z.string().optional(),
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
              ...(p.status
                ? this._mediaService.toUploadStatus(p)
                : {
                    id: p.id,
                    path: p.path,
                    ...(p.processingError ? { error: p.processingError } : {}),
                  }),
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
