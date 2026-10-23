import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { storeUrlAsMedia } from '@gitroom/nestjs-libraries/chat/tools/media.upload.helper';

@Injectable()
export class UploadFromUrlTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  private storage = UploadFactory.createStorage();
  name = 'uploadFromUrlTool';

  run() {
    return createTool({
      id: 'uploadFromUrlTool',
      description: `Uploads a remote image, video or audio file (mp3, wav) into the media library from a public http(s) URL.
This is how anything produced OUTSIDE this system gets onto a post: an AI generator's result URL, a link the user pasted, a file an external editing tool handed back. Those URLs are usually temporary: attached directly, a post may look fine and then point at a file that expires before it publishes. The "path" this returns is the durable hosted copy, and that path is what every attachments field (and replacePostAsset's newPath) takes.
Local or private files cannot be fetched by this tool; uploadWidgetTool (in apps that show it), uploadMediaTool (a small file) and createUploadLinkTool (anything bigger) take those.
Returns the hosted media { id, path }, or { error } on failure. An image's or video's path is used as an attachment (or an image's as the src of an <img> in the content, when the channel rules say pictures go inside the content); an mp3 is kept as a file to download again and is refused as a post attachment.
With adjust set to true (off by default) an image or video is also adjusted to the platforms' limits after the upload, for media a platform may reject as too large, too small or in an unsupported encoding: videos get their short side scaled to 1080 px (up or down, long side at most 1920 px) and are re-encoded to H.264 MP4 with AAC audio at up to 60 fps; images are only scaled down (short side at most 1080 px, long side at most 1920 px) and keep their format. GIF, AVIF, BMP and TIFF files are stored as uploaded.
Without adjust the path is usable at once. With adjust the returned status is "processing" until the adjusted file replaces the original at the same path, usually within seconds; a post published while it is processing uses the original, unadjusted file. mediaStatusTool reports, by the returned id, when the adjusted file is in place.`,
      mcp: {
        annotations: {
          title: 'Upload Media From URL',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        url: z
          .string()
          .url()
          .describe(
            'The public http(s) URL of the image, video or audio file (mp3, wav) to upload. Local files and private hosts are not supported'
          ),
        adjust: z
          .boolean()
          .optional()
          .describe(
            "Adjust the media to the platforms' limits (resize and re-encode) after the upload. Defaults to false"
          ),
      }),
      // Mastra validates a tool's return against this schema, so it must also
      // allow the graceful { error } shape. Fields are optional (rather than
      // wrapping everything in an `output` union) to keep the change minimal:
      // the existing { id, path } success return and the new { error } return
      // both validate without rewriting every return statement.
      outputSchema: z.object({
        id: z.string().optional(),
        path: z.string().optional(),
        status: z.string().optional(),
        warning: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const org = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );

          // Adjusting runs the media processor on the stored file, which only
          // the media service's own upload starts. Without it, the whole
          // fetch-sniff-store pipeline (SSRF-safe fetch, size caps, byte
          // sniffing, storage) is shared with the copy-on-attach path in
          // post.write.shared, so there is exactly one implementation of
          // "make a remote file durable".
          if (inputData.adjust) {
            return this._mediaService.toUploadStatus(
              (await this._mediaService.uploadFromUrl(
                org.id,
                inputData.url,
                true
              )) as any
            );
          }

          return await storeUrlAsMedia({
            storage: this.storage,
            mediaService: this._mediaService,
            organizationId: org.id,
            url: inputData.url,
          });
        } catch (err) {
          // undici's fetch rejects with a generic TypeError('fetch failed')
          // and hides the real reason (DNS, TLS, SSRF block, ...) in
          // err.cause, so walk the chain and surface it for the agent.
          // Error.cause isn't in the es2020 lib typings this repo compiles
          // against, hence the cast
          const message =
            err instanceof Error ? err.message : 'Unexpected error';
          const causes: string[] = [];
          let cause = (err as Error & { cause?: unknown })?.cause;
          while (cause instanceof Error) {
            if (cause.message) {
              causes.push(cause.message);
            }
            cause = (cause as Error & { cause?: unknown }).cause;
          }
          const causeText = causes.length ? ` (${causes.join(': ')})` : '';

          return {
            error: `Failed to upload media from URL: ${message}${causeText}`,
          };
        }
      },
    });
  }
}
