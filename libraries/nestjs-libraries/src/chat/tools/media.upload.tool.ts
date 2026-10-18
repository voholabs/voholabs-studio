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
      description: `Uploads a local image, video or audio file (mp3, wav) into the media library from its bytes, base64 encoded.
It suits small local files (roughly under 1MB) that are not reachable by URL. createUploadLinkTool transfers a larger image or video (photos from a camera or phone, any video) over HTTP, without putting it in the conversation; it takes no audio, so an mp3 comes in here or through uploadFromUrlTool.
Returns the hosted media { id, path }; the "path" of an image or video is what a post takes as an attachment. An audio file is kept as a file to download again and is refused as a post attachment.`,
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
