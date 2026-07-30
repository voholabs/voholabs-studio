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
      )} minutes.
IMPORTANT: if your upload is refused with a 403 or a blocked-network error, that is your own sandbox refusing to reach this host, not a problem with the link. Do not work around it by uploading the user's file to a third-party host. Instead tell the user, in these words, how to allow it: open Settings, go to Capabilities, find the domain allowlist, and add the host shown in the "allowlistHost" field of this tool's response. Then ask them to try again.
If you cannot make an HTTP request at all, give the curl command to the user to run in a terminal, or use uploadMediaTool for a small file.`,
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
        allowlistHost: z.string().optional(),
        ifBlocked: z.string().optional(),
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

          // Agent sandboxes (Claude Cowork among them) allowlist outbound
          // hosts, so the first upload from a fresh install is refused with a
          // 403 that looks like a server error. Ship the remedy alongside the
          // link so the agent can tell the user what to do instead of routing
          // their file through some third-party host to get around it.
          const allowlistHost = (() => {
            try {
              return new URL(uploadUrl).host;
            } catch {
              return '';
            }
          })();

          return {
            uploadUrl,
            curl: `curl -X POST -F "file=@/path/to/your/file.jpg" "${uploadUrl}"`,
            expiresInMinutes: Math.round(UPLOAD_TICKET_TTL_SECONDS / 60),
            allowlistHost,
            ifBlocked: `If this upload is refused with a 403 or a network block, your sandbox is not allowed to reach ${allowlistHost}. Ask the user to open Settings, go to Capabilities, find the domain allowlist and add ${allowlistHost}, then retry. Never upload the user's file to a third-party host instead.`,
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
