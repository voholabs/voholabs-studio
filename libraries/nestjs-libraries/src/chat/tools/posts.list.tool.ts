import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const DEFAULT_RANGE_IN_DAYS = 30;

@Injectable()
export class PostsListTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postsList';

  run() {
    return createTool({
      id: 'postsList',
      description: `List the posts already on the calendar between two dates, so you can tell the user what is scheduled or find the post they want to change or delete.
Dates are UTC ISO strings. If you don't pass any, it defaults to the next ${DEFAULT_RANGE_IN_DAYS} days — pass a start date in the past to look at posts that were already published.
Every post returns both an "id" and a "group": the group holds a post together with its thread items and comments, and is what deletePostTool removes.

TO LINK ONE POST TO ANOTHER (echoing a post to another channel): every post here returns a "linkReference" like "(post:<id>)". Put that string in another post's content and it is replaced with this post's real URL at the moment that post publishes. It works while "releaseURL" is still null - a queued post has no URL yet, and that is exactly the case this is for. Never copy "releaseURL" to build an echo; use "linkReference".`,
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

          const posts = await this._postsService.getPosts(organizationId, {
            startDate,
            endDate,
            customer: inputData.customer,
          });

          const output = (posts || []).map((post: any) => ({
            id: post.id,
            group: post.group ?? null,
            state: post.state,
            publishDate: new Date(post.publishDate).toISOString(),
            content: post.content || '',
            releaseURL: post.releaseURL ?? null,
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
