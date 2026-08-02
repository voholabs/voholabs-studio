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
      description: `Delete (unschedule) a post that is on the calendar. Use postsList first to find the post.
Pass either the post "id" or its "group" — both delete the whole group, meaning the post together with its thread items and comments on that channel.
A queued post is removed from the schedule and will not be published. A post that was already published is removed from the calendar only and stays live on the social network, unless you also pass deleteFromPlatform.
Set deleteFromPlatform to true to additionally delete the published message on the social network itself. Only some platforms support this (Discord does); the rest report back that they cannot.
This cannot be undone, so always confirm with the user before calling it — especially with deleteFromPlatform, which destroys the live post and any reactions or replies on it.`,
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
