import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { ValidUrlPath } from '@gitroom/helpers/utils/valid.url.path';
import {
  fetchImageAsBase64,
  MAX_PREVIEW_ITEMS,
  TOTAL_BYTE_BUDGET,
} from '@gitroom/nestjs-libraries/chat/tools/media.preview.helper';

const validUrlPath = new ValidUrlPath();

type Requested = { key: string; path: string | null; error?: string };

@Injectable()
export class MediaPreviewTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'mediaPreview';

  run() {
    return createTool({
      id: 'mediaPreview',
      description: `Look at images that are already in the media library or attached to a post — this returns the pictures themselves, not links to them.
Use it the moment you need to SEE a post's images: pass the "path" of each attachment from postsList (or media ids from mediaList) and the images come back in this one call, in the order you asked for them, so a carousel stays in its slide order. There is no need to download anything first.
Previews PNG, JPEG, GIF and WebP. Anything else — including mp4 video — comes back as a per-item note saying what the file actually is, with the rest of the batch still returned.
Up to ${MAX_PREVIEW_ITEMS} images per call. It only reads: nothing is uploaded, changed or deleted.`,
      mcp: {
        annotations: {
          title: 'Preview Media',
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
            'Media paths to preview, in the order you want them back. This is the usual way in: it is the same "path" postsList returns for each attachment and mediaList returns for each asset.'
          ),
        ids: z
          .array(z.string())
          .optional()
          .describe(
            'Media library ids to preview, as an alternative to paths. Note these are mediaList ids — a post attachment does not carry one, so use "paths" for anything read off a post.'
          ),
      }),
      // Passthrough is load-bearing: the tool returns `{ structuredContent,
      // content }` so the MCP server emits real image blocks, and a plain
      // object schema would strip both keys before they ever got there.
      // The declared fields below are what a client sees as the output shape.
      outputSchema: z
        .object({
          images: z
            .array(
              z.object({
                key: z
                  .string()
                  .describe('The path or id that was asked for'),
                path: z.string().nullable(),
                originalName: z.string().nullable(),
                mimeType: z.string().optional(),
                bytes: z.number().optional(),
                previewed: z
                  .boolean()
                  .describe(
                    'Whether this item is present as an image in the content of this response'
                  ),
                error: z.string().optional(),
              })
            )
            .optional()
            .describe(
              'One entry per requested item, in the order requested. Items with previewed=true appear as images, in this same order.'
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
                  'Pass either "paths" or "ids", not both, so the order of the images is unambiguous.',
              },
            };
          }

          const requestedKeys: string[] = paths.length ? paths : ids;
          if (requestedKeys.length > MAX_PREVIEW_ITEMS) {
            return {
              structuredContent: {
                error: `Too many items: ${requestedKeys.length} (max ${MAX_PREVIEW_ITEMS} per call). Ask for them in smaller batches.`,
              },
            };
          }

          // One query for the whole batch, always scoped to this organization —
          // that scoping is what stops the tool being a general URL fetcher.
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

          const requested: Requested[] = requestedKeys.map((key) => {
            const row = byKey.get(key);
            if (row) {
              return { key, path: row.path };
            }

            // Not in the library. An id we cannot resolve is simply not this
            // organization's. A path might still be a legitimate older
            // attachment, so it is allowed through only if it points at the
            // configured upload domain — never at an arbitrary host.
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
                  'This path is not in your media library and is not on an allowed upload domain, so it was not fetched.',
              };
            }

            return { key, path: key };
          });

          const images: any[] = [];
          const content: any[] = [];
          let spent = 0;

          // Sequential on purpose: the byte budget is a running total, and
          // firing every fetch at once would blow past it before any of them
          // returned.
          for (const item of requested) {
            const row = byKey.get(item.key);
            const originalName = row?.originalName ?? null;

            if (!item.path) {
              images.push({
                key: item.key,
                path: null,
                originalName,
                previewed: false,
                error: item.error,
              });
              continue;
            }

            const result = await fetchImageAsBase64(
              item.path,
              TOTAL_BYTE_BUDGET - spent
            );

            if (result.error) {
              images.push({
                key: item.key,
                path: item.path,
                originalName,
                previewed: false,
                error: result.error,
              });
              continue;
            }

            spent += result.bytes || 0;
            content.push({
              type: 'image',
              data: result.base64,
              mimeType: result.mimeType,
            });
            images.push({
              key: item.key,
              path: item.path,
              originalName,
              mimeType: result.mimeType,
              bytes: result.bytes,
              previewed: true,
            });
          }

          // `content` is handed straight to the client as MCP content blocks;
          // `structuredContent` stays the readable JSON. Keeping the base64 out
          // of the latter is what stops every image being sent twice.
          return content.length
            ? { structuredContent: { images }, content }
            : { structuredContent: { images } };
        } catch (err) {
          return {
            structuredContent: {
              error: `Failed to preview media: ${
                err instanceof Error ? err.message : 'Unexpected error'
              }`,
            },
          };
        }
      },
    });
  }
}
