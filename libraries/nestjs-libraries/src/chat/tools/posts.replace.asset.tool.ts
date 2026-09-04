import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AllProvidersSettings } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  attachmentUrl,
  describeMedia,
  hostExternalAttachments,
  mediaOutput,
  readPostMedia,
} from '@gitroom/nestjs-libraries/chat/tools/post.write.shared';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

@Injectable()
export class PostsReplaceAssetTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _mediaService: MediaService
  ) {}
  name = 'replacePostAsset';

  run() {
    return createTool({
      id: 'replacePostAsset',
      description: `Swap exactly ONE image or video on a post — or on one of its thread items — for another, and leave everything else untouched: every other attachment, every thread item, all text, the schedule.
This is the tool for "change the image on my post". Do NOT do that through editPostTool: its "attachments" field replaces the post's entire media list (passing only the new file silently drops the other media), and its "comments" field makes you resend every thread item. This tool cannot lose anything it was not asked to replace.
The swap only happens with the user's approval. Before calling this tool: show the user the proposed replacement — call mediaPreview for its media-library path, then download and actually display the picture yourself, not just its link or name — and get their explicit yes. Only then call this. Replacing is not reversible from here: this tool has no undo, and the asset it removed comes back only if its path still exists in the media library and you run a second swap the other way. A call the user has not seen and approved is a call made too early.
Find the target with postsList: pass the post's "id", the attachment's exact "path" as "currentPath", and the replacement as "newPath". The replacement must be a media-library path — anything produced elsewhere (an AI generator's result URL, a pasted link) goes through uploadFromUrlTool first, and the "path" it returns is what you pass here.
For an asset on a thread item, add "commentIndex" (zero-based position in the "comments" list). If "currentPath" is not on the target, nothing is changed and the error names the paths that are there, so you can correct and retry.
The output reports the post as it now stands, same shape as editPostTool, so you can confirm the swap. Schedule behaviour is also editPostTool's: a queued post stays queued and its publishing job is rebuilt, a draft stays a draft, and a post that has already published only has its calendar entry corrected ("livePostUnchanged" — the message live on the social network is not touched).`,
      mcp: {
        annotations: {
          title: 'Replace One Post Asset',
          readOnlyHint: false,
          // Destructive on purpose: the replaced asset has no undo here, so
          // clients that honor the hint ask the user before the call runs.
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        id: z
          .string()
          .describe(
            'The id of the post (from postsList). Always the post id, even when the asset lives on a thread item — point at the item with commentIndex.'
          ),
        currentPath: z
          .string()
          .describe(
            'The exact "path" of the attachment to replace, as postsList or editPostTool returned it. If the same path appears more than once on the target, add assetIndex to say which occurrence.'
          ),
        assetIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Zero-based position of the attachment on the target. Only needed when currentPath appears there more than once; when passed, the attachment at this position must actually have currentPath, so a stale index fails instead of replacing the wrong asset.'
          ),
        newPath: attachmentUrl.describe(
          'The media-library path of the replacement (from mediaList, uploadMediaTool or uploadFromUrlTool). An external URL passed here is automatically copied into the media library before the swap, so the post never stores a link that can expire — the output shows the hosted path it became.'
        ),
        commentIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Zero-based index of the thread item / comment to change, in the order postsList and editPostTool return them. Omit to change the post itself.'
          ),
      }),
      outputSchema: z.object({
        id: z.string().optional(),
        group: z
          .string()
          .nullable()
          .optional()
          .describe(
            'The group id after the edit — editing gives the post a new group, so use this one from now on'
          ),
        state: z.string().optional(),
        publishDate: z.string().optional(),
        content: z.string().optional(),
        attachments: z.array(mediaOutput).optional(),
        comments: z
          .array(
            z.object({
              id: z.string(),
              content: z.string(),
              attachments: z.array(mediaOutput),
            })
          )
          .optional(),
        livePostUnchanged: z
          .boolean()
          .optional()
          .describe(
            'The post had already published: only the calendar entry was corrected, the message on the social network is untouched'
          ),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const existing = await this._postsService.getPostsRecursively(
            inputData.id,
            true,
            organizationId,
            true
          );

          const current = existing?.[0] as any;

          if (!current) {
            return { error: `Could not find a post with id ${inputData.id}` };
          }

          if (current.parentPostId) {
            return {
              error:
                'That id belongs to a thread item, not to the post itself. Pass the id postsList returns for the post, and point at the item with "commentIndex".',
            };
          }

          const integrationId =
            current.integration?.id || current.integrationId || '';

          if (!integrationId) {
            return {
              error:
                'This post has no channel attached, so there is nothing to edit against.',
            };
          }

          const items = existing.map((post: any) => ({
            id: post.id,
            content: post.content || '',
            delay: post.delay || 0,
            image: readPostMedia(post),
          }));

          const [post, ...comments] = items;

          const targetPosition = inputData.commentIndex;
          const target =
            targetPosition === undefined ? post : comments[targetPosition];

          if (!target) {
            return {
              error: `commentIndex ${targetPosition} is out of range — the post has ${comments.length} thread item(s). Read it with postsList and use the position in its "comments" list.`,
            };
          }

          const where =
            targetPosition === undefined
              ? 'the post'
              : `thread item ${targetPosition}`;

          const media: any[] = target.image || [];
          const matches = media
            .map((m: any, index: number) => ({ index, path: m?.path || '' }))
            .filter((m) => m.path === inputData.currentPath);

          if (!matches.length) {
            const carried = media.map((m: any) => m?.path || '').filter(Boolean);
            return {
              error: carried.length
                ? `No attachment with path "${inputData.currentPath}" on ${where}. It carries: ${carried.join(
                    ', '
                  )}. Nothing was changed — pass one of those paths exactly as listed.`
                : `${where} has no attachments, so there is nothing to replace. Nothing was changed — to ADD media, use editPostTool's attachments field.`,
            };
          }

          // Refuse to guess between identical paths: replacing "the wrong copy"
          // is invisible in the output (both slots read back the same), so the
          // agent must say which slot it means.
          if (matches.length > 1 && inputData.assetIndex === undefined) {
            return {
              error: `"${inputData.currentPath}" appears ${
                matches.length
              } times on ${where} (positions ${matches
                .map((m) => m.index)
                .join(', ')}). Nothing was changed — pass assetIndex to say which one to replace.`,
            };
          }

          const replaceAt =
            inputData.assetIndex === undefined
              ? matches[0].index
              : inputData.assetIndex;

          if (
            inputData.assetIndex !== undefined &&
            (media[replaceAt]?.path || '') !== inputData.currentPath
          ) {
            return {
              error: `The attachment at position ${replaceAt} of ${where} is "${
                media[replaceAt]?.path || 'nothing'
              }", not "${inputData.currentPath}". Nothing was changed — your read may be stale; list the post again and retry.`,
            };
          }

          // Copy-on-attach: if the replacement is an external URL, re-host it
          // before anything is written, so the post never stores a link that
          // can expire. Throws (caught below) when it cannot be copied — the
          // post is untouched at that point.
          const hosted = await hostExternalAttachments({
            mediaService: this._mediaService,
            organizationId,
            paths: [inputData.newPath],
          });
          const newPath = hosted.get(inputData.newPath) ?? inputData.newPath;

          const value = items.map((item: any, index: number) => {
            const isTarget =
              targetPosition === undefined
                ? index === 0
                : index === targetPosition + 1;

            if (!isTarget) {
              return item;
            }

            return {
              ...item,
              image: item.image.map((m: any, mediaIndex: number) =>
                mediaIndex === replaceAt
                  ? { id: makeId(10), path: newPath }
                  : m
              ),
            };
          });

          const currentSettings = (() => {
            try {
              return JSON.parse(current.settings || '{}') || {};
            } catch (err) {
              return {};
            }
          })();

          const settings = {
            ...currentSettings,
            __type:
              current.integration?.providerIdentifier ||
              currentSettings.__type,
          } as AllProvidersSettings;

          // A published post can only be corrected on the calendar: 'update'
          // leaves the state alone and does not start a publishing workflow.
          const type =
            current.state === 'DRAFT'
              ? 'draft'
              : current.state === 'QUEUE'
              ? 'schedule'
              : 'update';

          // Same server-side validation the dashboard and editPostTool run —
          // the text is unchanged, but the new asset can still break a
          // channel's media rules.
          const [validation] = await this._postsService.validatePosts(
            organizationId,
            [
              {
                integration: { id: integrationId },
                settings,
                value: value.map((v: any) => ({
                  content: v.content,
                  image: v.image,
                })),
              },
            ]
          );

          if (type !== 'draft') {
            if (!validation.valid) {
              return {
                error: `${validation.name}: ${
                  validation.settingsError || 'Please fix your settings'
                }, nothing was changed.`,
              };
            }

            if (validation.errors !== true) {
              return {
                error: `${validation.name}: ${validation.errors}, nothing was changed.`,
              };
            }
          }

          await this._postsService.createPost(
            organizationId,
            {
              type,
              date: new Date(current.publishDate).toISOString(),
              // The stored content is already shortlinked if it ever was, and
              // re-running it would shorten the links a second time.
              shortLink: false,
              tags: (current.tags || []).map((t: any) => ({
                value: t.tag?.id,
                label: t.tag?.name,
              })),
              ...(current.intervalInDays
                ? { inter: current.intervalInDays }
                : {}),
              posts: [
                {
                  integration: { id: integrationId },
                  // Passing the existing group is what makes this an edit: the
                  // rows are upserted under a new group.
                  group: current.group,
                  reviewed: !!current.reviewed,
                  settings,
                  value,
                },
              ],
            } as any,
            'MCP'
          );

          const [updated, ...updatedComments] =
            (await this._postsService.getPostsRecursively(
              inputData.id,
              true,
              organizationId,
              true
            )) as any[];

          return {
            id: updated?.id || inputData.id,
            group: updated?.group ?? null,
            state: updated?.state || current.state,
            publishDate: new Date(
              updated?.publishDate || current.publishDate
            ).toISOString(),
            content: updated?.content || '',
            attachments: describeMedia(updated),
            comments: (updatedComments || []).map((comment: any) => ({
              id: comment.id,
              content: comment.content || '',
              attachments: describeMedia(comment),
            })),
            ...(type === 'update' ? { livePostUnchanged: true } : {}),
          };
        } catch (err) {
          return {
            error: `Failed to replace the asset: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
