import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostsDeleteTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'deletePostTool';

  run() {
    return createTool({
      id: 'deletePostTool',
      description: `Deletes (unschedules) a post that is on the calendar, found with postsList.
Deleting removes the post for good. editPostTool changes a post in place (rewording, swapping media, moving it) and keeps everything not passed; deleting and re-creating loses the post's attachments and its history.
The post "id" and its "group" both delete the whole group: the post together with its thread items and comments on that channel.
A queued post is removed from the schedule and will not be published. A post that was already published is removed from the calendar only and stays live on the social network, unless deleteFromPlatform is true.
deleteFromPlatform: true also deletes the published message on the social network itself, with any reactions or replies on it. Only some platforms support this (Discord does); the rest report back that they cannot.
A deletion cannot be undone.
On a workspace that pays for a channel from its wallet, the credits paid for the parts that were not sent yet are given back.

ECHOES: a post that embeds this one's URL with "(post:<id>)" breaks when this post is deleted. Its reference cannot resolve, so it fails at publish time instead of going out (a silent no-show rather than a visible broken link), and that cascades to anything echoing it. When such posts exist this tool refuses and lists them in "breaksEchoes"; with breakEchoes: true it deletes anyway, and those posts are left to be repaired or deleted.`,
      mcp: {
        annotations: {
          title: 'Delete Scheduled Post',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe('The id of the post to delete (from postsList)'),
        group: z
          .string()
          .optional()
          .describe(
            'The group id of the post to delete (from postsList) — used when the id is not known'
          ),
        deleteFromPlatform: z
          .boolean()
          .optional()
          .describe(
            'Also delete the already-published message on the social network itself, not just the calendar entry. Defaults to false.'
          ),
        breakEchoes: z
          .boolean()
          .optional()
          .describe(
            'Delete even though other posts reference this one (the "breaksEchoes" list of the refusal) and will fail to publish because of it.'
          ),
      }),
      outputSchema: z.object({
        success: z.boolean().optional(),
        group: z.string().optional(),
        deletedFromPlatform: z
          .array(z.string())
          .optional()
          .describe('Platform message ids that were taken down'),
        platformErrors: z
          .array(z.string())
          .optional()
          .describe(
            'Published posts that could not be removed from the platform; the calendar entry was still deleted'
          ),
        breaksEchoes: z
          .array(
            z.object({
              id: z.string(),
              content: z.string(),
              publishDate: z.string(),
              state: z.string(),
              channel: z.string(),
            })
          )
          .optional()
          .describe(
            'Posts that embed this one\'s URL. On a refusal these are what stopped it; on a forced delete these are the posts that will now fail to publish.'
          ),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          if (!inputData.id && !inputData.group) {
            return { error: 'Pass either a post id or a group id to delete.' };
          }

          let group = inputData.group;
          if (!group) {
            // getPost throws when the id belongs to another organization or
            // doesn't exist, so the agent gets a readable message instead.
            const post = await this._postsService
              .getPost(organizationId, inputData.id!)
              .catch(() => undefined);

            group = post?.group;
            if (!group) {
              return { error: `Could not find a post with id ${inputData.id}` };
            }
          }

          // Anything echoing this post can never resolve its reference once the
          // post is gone, and fails at publish time instead of going out. That
          // is invisible unless someone is told, so find them before deleting.
          const inGroup = await this._postsService.getPostIdsInGroup(
            organizationId,
            group
          );

          const dependents = await this._postsService.getPostsReferencing(
            organizationId,
            inGroup.map((p) => p.id)
          );

          const breaksEchoes = dependents.map((post: any) => ({
            id: post.id,
            content: post.content || '',
            publishDate: new Date(post.publishDate).toISOString(),
            state: post.state,
            channel: post.integration?.name || '',
          }));

          if (breaksEchoes.length && !inputData.breakEchoes) {
            return {
              error: `This post is referenced by ${
                breaksEchoes.length
              } other post${
                breaksEchoes.length === 1 ? '' : 's'
              }, which would fail to publish once it is gone rather than going out with a broken link. Show the user the breaksEchoes list. To change this post's wording instead, use editPostTool — it keeps the id, so the echoes keep working. To delete anyway, call again with breakEchoes: true.`,
              breaksEchoes,
            };
          }

          // Has to run first: it reads the rows deletePost soft-deletes.
          const platform = inputData.deleteFromPlatform
            ? await this._postsService.deletePostsFromPlatform(
                organizationId,
                group
              )
            : undefined;

          // deletePost soft-deletes every post of the group and terminates the
          // publishing workflow. Its return value is a legacy { error: true }
          // shape, so report the outcome from here instead.
          await this._postsService.deletePost(organizationId, group);

          return {
            success: true,
            group,
            ...(breaksEchoes.length ? { breaksEchoes } : {}),
            ...(platform
              ? {
                  deletedFromPlatform: platform.deleted,
                  ...(platform.errors.length
                    ? { platformErrors: platform.errors }
                    : {}),
                }
              : {}),
          };
        } catch (err) {
          return {
            error: `Failed to delete the post: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
