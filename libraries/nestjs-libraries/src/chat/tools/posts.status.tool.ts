import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@Injectable()
export class PostsStatusTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postStatusTool';

  run() {
    return createTool({
      id: 'postStatusTool',
      description: `Move a post between draft and the schedule.
Setting it to DRAFT takes a queued post off the schedule so it will not publish, without deleting it. Setting it to QUEUE puts a draft back on the schedule at its existing time, so check that time is still in the future before doing it, or it may go out immediately.
Use postsList to find the post. This does nothing to a post that has already been published.`,
      mcp: {
        annotations: {
          title: 'Change Post Status',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        id: z.string().describe('The post id, from postsList'),
        status: z
          .enum(['QUEUE', 'DRAFT'])
          .describe('QUEUE puts it on the schedule, DRAFT takes it off'),
      }),
      outputSchema: z.object({
        changed: z.boolean().optional(),
        status: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          await this._postsService.changePostStatus(
            organizationId,
            inputData.id,
            inputData.status
          );

          return { changed: true, status: inputData.status };
        } catch (err) {
          return {
            error: `Failed to change the post status: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
