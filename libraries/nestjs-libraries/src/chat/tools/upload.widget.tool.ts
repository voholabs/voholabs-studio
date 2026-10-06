import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { UPLOAD_WIDGET_URI } from '@gitroom/nestjs-libraries/chat/ui/upload.widget';

@Injectable()
export class UploadWidgetTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'uploadWidgetTool';

  run() {
    return createTool({
      id: 'uploadWidgetTool',
      description: `Show the user an upload box to add images or videos from their own device to the media library. The file goes straight from their device to storage, so large videos (up to 1 GB) work.
Use this whenever the user wants to post a photo or video they have on their device, or attached in the chat. When the media is already on a public URL, use uploadFromUrlTool instead.
The box only appears in apps that support MCP Apps (interactive UI), such as Claude and ChatGPT. Elsewhere use createUploadLinkTool or uploadFromUrlTool.
Returns a sessionId. The files the user uploads are reported in the conversation, and can also be read with uploadWidgetStatusTool. Each one has an { id, path } to attach to a post.`,
      mcp: {
        annotations: {
          title: 'Upload Media From Device',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        _meta: {
          ui: {
            resourceUri: UPLOAD_WIDGET_URI,
          },
          'openai/outputTemplate': UPLOAD_WIDGET_URI,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        sessionId: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const org = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );
          return {
            sessionId: await this._mediaService.createUploadSession(org.id),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Failed to open the upload box: ${message}` };
        }
      },
    });
  }
}
