import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { storeUrlAsMedia } from '@gitroom/nestjs-libraries/chat/tools/media.upload.helper';

// ChatGPT hands a file the user attached to the chat to a tool as a temporary
// download link (openai/fileParams), so the file never has to leave ChatGPT's
// sandbox, which cannot reach outside hosts.
@Injectable()
export class UploadChatFileTool implements AgentToolInterface {
  private storage = UploadFactory.createStorage();

  constructor(private _mediaService: MediaService) {}
  name = 'uploadChatFileTool';

  run() {
    return createTool({
      id: 'uploadChatFileTool',
      description: `Add an image or video the user attached to this chat to the media library. In ChatGPT, use this whenever the user attaches a file and wants it in Studio or on a post: pass the attachment as "file".
Returns the hosted media { id, path } to use as an attachment, or { error }. If it fails or the file is not available, call uploadWidgetTool so the user can pick the file in the upload box.`,
      mcp: {
        annotations: {
          title: 'Upload File From Chat',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        _meta: {
          'openai/fileParams': ['file'],
        },
      },
      inputSchema: z.object({
        file: z
          .object({
            download_url: z.string(),
            file_id: z.string(),
            mime_type: z.string().optional(),
            file_name: z.string().optional(),
          })
          .describe('The file the user attached to the chat'),
      }),
      outputSchema: z.object({
        id: z.string().optional(),
        path: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const url = inputData?.file?.download_url;
        if (!url) {
          return {
            error:
              'The attached file was not passed through. Call uploadWidgetTool so the user can pick it in the upload box.',
          };
        }
        try {
          const org = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );
          return await storeUrlAsMedia({
            storage: this.storage,
            mediaService: this._mediaService,
            organizationId: org.id,
            url,
          });
        } catch (err) {
          return {
            error: `Failed to add the attached file: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }. Call uploadWidgetTool so the user can pick it in the upload box.`,
          };
        }
      },
    });
  }
}
