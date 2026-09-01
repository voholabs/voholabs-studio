import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { readPostMedia } from '@gitroom/nestjs-libraries/chat/tools/post.write.shared';
import { guessMimeFromPath } from '@gitroom/nestjs-libraries/chat/tools/media.preview.helper';

const DEFAULT_RANGE_IN_DAYS = 30;

const parseSettings = (settings?: string | null) => {
  try {
    return JSON.parse(settings || '{}') || {};
  } catch (err) {
    return {};
  }
};

@Injectable()
export class PostsListTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _mediaService: MediaService
  ) {}
  name = 'postsList';

  run() {
    return createTool({
      id: 'postsList',
      description: `List the posts already on the calendar between two dates, so you can tell the user what is scheduled or find the post they want to change or delete.
Dates are UTC ISO strings. If you don't pass any, it defaults to the next ${DEFAULT_RANGE_IN_DAYS} days — pass a start date in the past to look at posts that were already published.
Every post returns both an "id" and a "group": the group holds a post together with its thread items and comments, and is what deletePostTool removes.
Every post also returns "attachments" — the media it carries, with the same "path" the media library uses. That is how you tell whether a post already has its image or video on it, without opening anything.
TO SEE those images rather than just know they exist, pass their "path" values to mediaPreview and it returns the pictures themselves in one call, in slide order. Do that instead of downloading the URLs yourself. Each attachment also carries "mediaId", "originalName" and a "mimeType" hint so you can tell a video from an image before asking.
TO CHANGE A POST, use editPostTool with its "id". It edits in place and keeps whatever you do not pass, attachments included. Deleting and re-creating a post is not the way to reword it: it loses the media, the post's history and its id.

Every post returns its "settings" too — the channel options it was scheduled with, such as which Discord channel it goes to or an X post's reply permissions and AI-disclosure flags. That is what you read back when you need to know how a post is configured, and what editPostTool merges into rather than replacing.

TO LINK ONE POST TO ANOTHER (echoing a post to another channel): every post here returns a "linkReference" like "(post:<id>)". Put that string in another post's content and it is replaced with this post's real URL at the moment that post publishes. It works while "releaseURL" is still null - a queued post has no URL yet, and that is exactly the case this is for. Never copy "releaseURL" to build an echo; use "linkReference".
"references" lists the posts THIS one points at. A chain is only as good as its links: if a post it references is deleted, the reference can never resolve and this post fails at publish time instead of going out with a broken link — a silent no-show. So edit posts rather than deleting them, and check what a delete would break before you run it (deletePostTool refuses and names them).`,
      mcp: {
        annotations: {
          title: 'List Scheduled Posts',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        startDate: z
          .string()
          .optional()
          .describe('Start of the range, UTC ISO date (defaults to now)'),
        endDate: z
          .string()
          .optional()
          .describe(
            `End of the range, UTC ISO date (defaults to ${DEFAULT_RANGE_IN_DAYS} days from now)`
          ),
        customer: z
          .string()
          .optional()
          .describe(
            'Optional group (customer) id from the groupList tool, to only list posts of that customer'
          ),
      }),
      outputSchema: z.object({
        total: z.number().optional(),
        posts: z
          .array(
            z.object({
              id: z.string(),
              group: z.string().nullable(),
              state: z.string(),
              publishDate: z.string(),
              content: z.string(),
              releaseURL: z.string().nullable(),
              attachments: z
                .array(
                  z.object({
                    path: z
                      .string()
                      .describe(
                        'The media path — the same value mediaList returns and an attachments field takes. Pass this to mediaPreview to see the image.'
                      ),
                    thumbnail: z.string().nullable(),
                    mediaId: z
                      .string()
                      .nullable()
                      .describe(
                        'The media library id, when this attachment still resolves to a library row. Null for one that has since been deleted from the library — the path still previews.'
                      ),
                    originalName: z.string().nullable(),
                    mimeType: z
                      .string()
                      .nullable()
                      .describe(
                        'Best-effort type from the file extension, for telling an image from a video before previewing. mediaPreview checks the real bytes.'
                      ),
                  })
                )
                .describe('The images and videos attached to this post'),
              settings: z
                .record(z.any())
                .describe(
                  'The channel settings this post was scheduled with (Discord channel, X reply permissions, AI disclosure, and so on)'
                ),
              references: z
                .array(z.string())
                .describe(
                  'Ids of the posts this one embeds a live URL of. If one of them is deleted, this post fails at publish time rather than going out.'
                ),
              linkReference: z
                .string()
                .describe(
                  "Paste this into ANOTHER post's content to embed this post's URL. It is replaced with the real URL when that post publishes, so it works even while releaseURL is still null. Use it instead of releaseURL to link one post to another."
                ),
              channel: z.object({
                id: z.string(),
                name: z.string(),
                platform: z.string(),
              }),
            })
          )
          .optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const startDate = inputData.startDate || new Date().toISOString();
          const endDate =
            inputData.endDate ||
            new Date(
              Date.now() + DEFAULT_RANGE_IN_DAYS * 24 * 60 * 60 * 1000
            ).toISOString();

          const posts = await this._postsService.getPosts(
            organizationId,
            {
              startDate,
              endDate,
              customer: inputData.customer,
            },
            { includeMedia: true, includeSettings: true }
          );

          // One lookup for every attachment across the whole page, rather than
          // a query per post. Attachments are stored as bare paths (a post's
          // `image` entries carry no media-library id), so the path is what
          // links them back to the library row and its name.
          const allPaths = Array.from(
            new Set(
              (posts || []).flatMap((post: any) =>
                readPostMedia(post)
                  .map((media: any) => media?.path)
                  .filter(Boolean)
              )
            )
          ) as string[];

          const mediaByPath = new Map<string, any>(
            (
              await this._mediaService.getMediaByPathsForOrg(
                organizationId,
                allPaths
              )
            ).map((row: any) => [row.path, row])
          );

          const output = (posts || []).map((post: any) => ({
            id: post.id,
            group: post.group ?? null,
            state: post.state,
            publishDate: new Date(post.publishDate).toISOString(),
            content: post.content || '',
            releaseURL: post.releaseURL ?? null,
            attachments: readPostMedia(post).map((media: any) => {
              const path = media?.path || '';
              const row = mediaByPath.get(path);
              return {
                path,
                // A video's thumbnail is stored on the post entry; fall back to
                // the library row for anything scheduled before that was kept.
                thumbnail: media?.thumbnail ?? row?.thumbnail ?? null,
                mediaId: row?.id ?? null,
                originalName: row?.originalName ?? null,
                mimeType: guessMimeFromPath(path),
              };
            }),
            settings: parseSettings(post.settings),
            references: this._postsService.extractPostReferences(
              `${post.content || ''}${post.settings || ''}`
            ),
            linkReference: `(post:${post.id})`,
            channel: {
              id: post.integration?.id || '',
              name: post.integration?.name || '',
              platform: post.integration?.providerIdentifier || '',
            },
          }));

          return { total: output.length, posts: output };
        } catch (err) {
          return {
            error: `Failed to list posts: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
