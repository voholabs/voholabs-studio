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
  private storage = UploadFactory.createStorage();

  constructor(private _mediaService: MediaService) {}
  name = 'uploadFromUrlTool';

  run() {
    return createTool({
      id: 'uploadFromUrlTool',
      description: `Upload a remote image or video into the media library from a public URL.
Anything produced OUTSIDE this system must come through here before it can go on a post: an AI generator's result URL, a link the user pasted, a file an external editing tool handed back. Those URLs are usually temporary — attaching one directly may appear to work, and the post is then pointing at a file that expires before it publishes. The "path" this returns is the durable hosted copy, and that path is what every attachments field (and replacePostAsset's newPath) takes.
Returns the hosted media { id, path } to use as an attachment, or { error } on failure.`,
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
          .describe('The public URL of the image or video to upload'),
      }),
      // Mastra validates a tool's return against this schema, so it must also
      // allow the graceful { error } shape. Fields are optional (rather than
      // wrapping everything in an `output` union) to keep the change minimal:
      // the existing { id, path } success return and the new { error } return
      // both validate without rewriting every return statement.
      outputSchema: z.object({
        id: z.string().optional(),
        path: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const org = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );

          // The whole fetch-sniff-store pipeline (SSRF-safe fetch, size caps,
          // byte sniffing, storage) is shared with the copy-on-attach path in
          // post.write.shared, so there is exactly one implementation of
          // "make a remote file durable".
          return await storeUrlAsMedia({
            storage: this.storage,
            mediaService: this._mediaService,
            organizationId: org.id,
            url: inputData.url,
          });
        } catch (err) {
          return {
            error: `Failed to upload media from URL: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
