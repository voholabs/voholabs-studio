import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { storeBufferAsMedia } from '@gitroom/nestjs-libraries/chat/tools/media.upload.helper';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

// Base64 travels inside the tool call itself, so the practical ceiling is far
// below the per-type upload limit — a few hundred KB is comfortable, a photo
// straight off a phone is not. Bigger files should go through
// createUploadLinkTool, which moves the bytes over plain HTTP instead.
const MAX_DECODED_BYTES = 5 * 1024 * 1024;

@Injectable()
export class MediaUploadTool implements AgentToolInterface {
  private storage = UploadFactory.createStorage();

  constructor(private _mediaService: MediaService) {}
  name = 'uploadMediaTool';

  run() {
    return createTool({
      id: 'uploadMediaTool',
      description: `Upload a local image or video into the media library by sending its bytes base64 encoded.
Use this for small files (roughly under 1MB) when you have the file locally and it is not reachable by URL.
For anything larger — photos from a camera or phone, or any video — use createUploadLinkTool instead, which transfers the file over HTTP without putting it in the conversation.
Returns the hosted media { id, path }; pass the "path" as the attachment when scheduling a post.`,
      mcp: {
        annotations: {
          title: 'Upload Media',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        fileName: z
          .string()
          .describe('File name to store it under, e.g. "product-shot.jpg"'),
        data: z
          .string()
          .describe(
            'The file content, base64 encoded. A "data:image/jpeg;base64,..." prefix is accepted and stripped.'
          ),
      }),
      outputSchema: z.object({
        id: z.string().optional(),
        path: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const base64 = String(inputData.data || '')
            .replace(/^data:[^;,]*;base64,/, '')
            .replace(/\s/g, '');

          if (!base64) {
            return { error: 'No file content was provided.' };
          }

          // Decoded length without allocating first, so an oversized payload is
          // rejected before it is turned into a buffer.
          const padding = base64.endsWith('==')
            ? 2
            : base64.endsWith('=')
            ? 1
            : 0;
          const decodedSize = Math.floor((base64.length * 3) / 4) - padding;
          if (decodedSize > MAX_DECODED_BYTES) {
            return {
              error: `That file is ${decodedSize} bytes, too large to send inline (max ${MAX_DECODED_BYTES}). Use createUploadLinkTool instead.`,
            };
          }

          const buffer = Buffer.from(base64, 'base64');
          if (!buffer.length) {
            return { error: 'The file content was not valid base64.' };
          }

          return await storeBufferAsMedia({
            storage: this.storage,
            mediaService: this._mediaService,
            organizationId,
            buffer,
            fileName: inputData.fileName,
          });
        } catch (err) {
          return {
            error: `Failed to upload the media: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
