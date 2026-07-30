import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { randomBytes } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  UPLOAD_TICKET_TTL_SECONDS,
  uploadTicketKey,
} from '@gitroom/nestjs-libraries/upload/upload.ticket';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class MediaUploadLinkTool implements AgentToolInterface {
  name = 'createUploadLinkTool';

  run() {
    return createTool({
      id: 'createUploadLinkTool',
      description: `Create a temporary upload link for putting a local file into the media library, for files too big to send inline.
Call this, then POST the file to the returned "uploadUrl" as multipart form data under the field name "file" — the returned "curl" string is ready to run once you replace the path with the real one.
The response of that POST is the hosted media { id, path }; pass the "path" as the attachment when scheduling a post.
The link works once and expires after ${Math.round(
        UPLOAD_TICKET_TTL_SECONDS / 60
      )} minutes. If you cannot make an HTTP request yourself, give the curl command to the user to run, or use uploadMediaTool for a small file.`,
      mcp: {
        annotations: {
          title: 'Create Media Upload Link',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        uploadUrl: z.string().optional(),
        curl: z.string().optional(),
        expiresInMinutes: z.number().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const token = randomBytes(32).toString('hex');
          await ioRedis.set(
            uploadTicketKey(token),
            organizationId,
            'EX',
            UPLOAD_TICKET_TTL_SECONDS
          );

          const uploadUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/public/v1/upload-ticket/${token}`;

          return {
            uploadUrl,
            curl: `curl -X POST -F "file=@/path/to/your/file.jpg" "${uploadUrl}"`,
            expiresInMinutes: Math.round(UPLOAD_TICKET_TTL_SECONDS / 60),
          };
        } catch (err) {
          return {
            error: `Failed to create an upload link: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
