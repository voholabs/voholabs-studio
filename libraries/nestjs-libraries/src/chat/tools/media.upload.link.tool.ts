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
      description: `Creates a temporary upload link for putting a local file into the media library, for files too big to send inline.
The file is POSTed to the returned "uploadUrl" as multipart form data under the field name "file". The returned "curl" string is ready to run once the path in it is the real one. The host refuses Python's built-in urllib (User-Agent "Python-urllib") with a 403 and "error code: 1010"; curl, the requests and httpx libraries, and any client whose User-Agent names it (for example "voholabs-upload/1.0") are accepted.
The response of that POST is the hosted media { id, path }; the "path" is what a post takes as an attachment.
When the calling environment cannot reach the uploadUrl (a sandbox that blocks the network, a proxy error), a retry fails the same way; uploadChatFileTool takes a file attached to the chat, and uploadWidgetTool shows an upload box where the user picks the file.
If the library has no room the POST is refused: on the free plan with 413 when it is full, and on a workspace that pays for storage from its wallet with 402 and a top-up link when the credits fall short of the extra storage (storage above the free amount is paid for when the file is uploaded).
The link works once and expires after ${Math.round(
        UPLOAD_TICKET_TTL_SECONDS / 60
      )} minutes.
A 403 whose body says "error code: 1010" is the host refusing the HTTP client, not the network: the same link still works with the curl command or a User-Agent as above. Any other 403, or a blocked-network error, is the calling environment's own network allowlist refusing this host, not a problem with the link; the host to allow is in "allowlistHost", and the file does not need to pass through any other host. The curl command also runs in the user's own terminal, and uploadMediaTool takes a small file inline.`,
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
            ifBlocked: `If the 403 body says "error code: 1010", the host refused your HTTP client: retry with the curl command, or send a User-Agent header such as "voholabs-upload/1.0" (Python's built-in urllib is refused). Any other 403 or a network block means your sandbox is not allowed to reach ${allowlistHost}. Ask the user to allow that domain in their assistant's network settings — in Claude: Settings, then Capabilities, then the domain allowlist — and retry. If they cannot, give them the curl command to run themselves. Never upload the user's file to a third-party host instead.`,
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
