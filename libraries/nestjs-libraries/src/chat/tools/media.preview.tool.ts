import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { ValidUrlPath } from '@gitroom/helpers/utils/valid.url.path';
import {
  guessMimeFromPath,
  MAX_REFERENCE_ITEMS,
  mediaKind,
  referenceName,
} from '@gitroom/nestjs-libraries/chat/tools/media.preview.helper';

const validUrlPath = new ValidUrlPath();

type Resolved = {
  key: string;
  path: string | null;
  row?: any;
  error?: string;
};

@Injectable()
export class MediaPreviewTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'mediaPreview';

  run() {
    return createTool({
      id: 'mediaPreview',
      description: `Get loadable references to media that is in the media library or attached to a post — images AND video alike.
Pass the "path" of each attachment from postsList (or media ids from mediaList) and each one comes back as an MCP resource link carrying the asset's URL, name and type, in the order you asked for, so a carousel keeps its slide order. Load the ones you need from those URLs.
Nothing is returned inline and nothing is re-encoded: you get the real asset at full quality, whatever its size, and video works the same way as an image. Use "kind" to tell them apart before loading — do not try to look at a video as a picture.
If loading a URL is refused with a 403 or a blocked network, that is the sandbox domain allowlist, not a missing file: tell the user to add that host in Settings → Capabilities. Never report an asset as unavailable when you were simply not allowed to fetch it.
It only reads: nothing is uploaded, changed or deleted.`,
      mcp: {
        annotations: {
          title: 'Get Media References',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        paths: z
          .array(z.string())
          .optional()
          .describe(
            'Media paths, in the order you want them back. This is the usual way in: it is the same "path" postsList returns for each attachment and mediaList returns for each asset.'
          ),
        ids: z
          .array(z.string())
          .optional()
          .describe(
            'Media library ids, as an alternative to paths. Note these are mediaList ids — a post attachment does not carry one, so use "paths" for anything read off a post.'
          ),
      }),
      // Passthrough is load-bearing: the tool returns `{ structuredContent,
      // content }` so the MCP server emits real resource_link blocks, and a
      // plain object schema would strip both keys before they got there.
      outputSchema: z
        .object({
          media: z
            .array(
              z.object({
                key: z.string().describe('The path or id that was asked for'),
                url: z
                  .string()
                  .nullable()
                  .describe('Load this to get the asset itself, at full quality'),
                mediaId: z.string().nullable(),
                name: z.string().nullable(),
                mimeType: z
                  .string()
                  .nullable()
                  .describe(
                    'Best-effort type from the file extension. The authoritative type is the Content-Type of the response when you load the URL.'
                  ),
                kind: z
                  .string()
                  .describe('"image", "video" or "unknown" — check before loading'),
                error: z.string().optional(),
              })
            )
            .optional()
            .describe(
              'One entry per requested item, in the order requested. Entries with a url also appear as resource links in the content of this response.'
            ),
          error: z.string().optional(),
        })
        .passthrough(),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const paths = inputData.paths || [];
          const ids = inputData.ids || [];

          if (!paths.length && !ids.length) {
            return {
              structuredContent: {
                error: 'Pass "paths" (from postsList or mediaList) or "ids".',
              },
            };
          }

          if (paths.length && ids.length) {
            return {
              structuredContent: {
                error:
                  'Pass either "paths" or "ids", not both, so the order of the references is unambiguous.',
              },
            };
          }

          const requestedKeys: string[] = paths.length ? paths : ids;
          if (requestedKeys.length > MAX_REFERENCE_ITEMS) {
            return {
              structuredContent: {
                error: `Too many items: ${requestedKeys.length} (max ${MAX_REFERENCE_ITEMS} per call).`,
              },
            };
          }

          // One query for the whole batch, always scoped to this organization.
          // Nothing is fetched here, but the scoping still matters: it is what
          // keeps the tool from turning any URL an agent invents into a
          // reference that looks like it came from the user's library.
          const rows = paths.length
            ? await this._mediaService.getMediaByPathsForOrg(
                organizationId,
                paths
              )
            : await this._mediaService.getMediaByIdsForOrg(organizationId, ids);

          const byKey = new Map<string, any>(
            (rows || []).map((row: any) => [
              paths.length ? row.path : row.id,
              row,
            ])
          );

          const resolved: Resolved[] = requestedKeys.map((key) => {
            const row = byKey.get(key);
            if (row) {
              return { key, path: row.path, row };
            }

            // An id we cannot resolve is simply not this organization's. A path
            // might still be a legitimate older attachment, so it is allowed
            // through only if it points at the configured upload domain.
            if (!paths.length) {
              return {
                key,
                path: null,
                error: 'No media with this id in your library.',
              };
            }

            if (!validUrlPath.validate(key, {} as any)) {
              return {
                key,
                path: null,
                error:
                  'This path is not in your media library and is not on an allowed upload domain.',
              };
            }

            return { key, path: key };
          });

          const media: any[] = [];
          const content: any[] = [];

          for (const item of resolved) {
            if (!item.path) {
              media.push({
                key: item.key,
                url: null,
                mediaId: null,
                name: null,
                mimeType: null,
                kind: 'unknown',
                error: item.error,
              });
              continue;
            }

            const mimeType = guessMimeFromPath(item.path);
            const name = referenceName(item.row?.originalName, item.path);
            const kind = mediaKind(item.row?.type, mimeType);

            content.push({
              type: 'resource_link',
              uri: item.path,
              name,
              ...(mimeType ? { mimeType } : {}),
            });

            media.push({
              key: item.key,
              url: item.path,
              mediaId: item.row?.id ?? null,
              name,
              mimeType,
              kind,
            });
          }

          // `content` is handed straight to the client as MCP content blocks;
          // `structuredContent` is the same list in readable form, so a client
          // that ignores resource links still has every URL.
          return content.length
            ? { structuredContent: { media }, content }
            : { structuredContent: { media } };
        } catch (err) {
          return {
            structuredContent: {
              error: `Failed to get media references: ${
                err instanceof Error ? err.message : 'Unexpected error'
              }`,
            },
          };
        }
      },
    });
  }
}
