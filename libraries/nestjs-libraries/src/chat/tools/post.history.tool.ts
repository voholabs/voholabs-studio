import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { PostRevisionService } from '@gitroom/nestjs-libraries/database/prisma/post-revisions/post-revision.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

const DEFAULT_LIMIT = 10;

@Injectable()
export class PostHistoryTool implements AgentToolInterface {
  constructor(
    private _postRevisionService: PostRevisionService,
    private _integrationService: IntegrationService
  ) {}
  name = 'postHistory';

  run() {
    return createTool({
      id: 'postHistory',
      description: `Compares the post as it was first drafted with the post that actually went out. Every difference is a change somebody made during review, which shows what this brand wants beyond what the draft already had.
By default it returns the posts still waiting to be reviewed: ones that published, whose text or media differ from the original draft, and that have not been learned from yet. Posts that went out untouched are left out, as there is nothing to compare. Nothing else in the product reads this; it exists for the agent.
Each diff shows how the draft turned into what finally went out. Removed words are marked [-like this-] and added words {+like this+}; media and per-channel settings are listed separately.
briefLearnTool records a lesson that would apply again. markLearned takes the chainIds with outcome RECORDED, or NO_SIGNAL for edits that were only typos, formatting or one-off details; either way the chain leaves the queue, so nothing is reviewed twice.`,
      mcp: {
        annotations: {
          title: 'Review How Posts Were Edited',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        chainId: z
          .string()
          .optional()
          .describe(
            'One specific post history, in place of the review queue'
          ),
        limit: z
          .number()
          .min(1)
          .max(25)
          .optional()
          .describe(`How many to return (defaults to ${DEFAULT_LIMIT})`),
        includeLearned: z
          .boolean()
          .optional()
          .describe(
            'Also return the ones already marked as learned from (default false)'
          ),
      }),
      outputSchema: z.object({
        total: z.number().optional(),
        posts: z
          .array(
            z.object({
              chainId: z.string(),
              publishedAt: z.string().nullable(),
              learned: z.boolean(),
              channel: z.object({
                id: z.string(),
                name: z.string(),
                platform: z.string(),
              }),
              textDiff: z.array(
                z.object({ item: z.number(), diff: z.string() })
              ),
              itemsAdded: z.number(),
              itemsRemoved: z.number(),
              mediaAdded: z.array(z.string()),
              mediaRemoved: z.array(z.string()),
              mediaReordered: z.boolean(),
              settingsChanged: z.array(z.string()),
              scheduleChange: z
                .object({ from: z.string(), to: z.string() })
                .optional(),
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

          const queue = await this._postRevisionService.getLearningQueue(
            organizationId,
            {
              chainId: inputData.chainId,
              limit: inputData.limit || DEFAULT_LIMIT,
              includeLearned: inputData.includeLearned,
            }
          );

          if (!queue.length) {
            return { total: 0, posts: [] };
          }

          const integrations =
            await this._integrationService.getIntegrationsList(organizationId);

          const posts = queue
            .filter((entry) => !!entry.diff)
            .map((entry) => {
              const integration = integrations.find(
                (current) => current.id === entry.final.integrationId
              );

              // A channel can be disconnected long after the post went out, so
              // fall back to what the snapshot itself remembers.
              const platform =
                integration?.providerIdentifier ||
                this._postRevisionService.parsePayload(entry.final.payload)
                  .settings?.__type ||
                '';

              return {
                chainId: entry.final.chainId,
                publishedAt: entry.final.publishedAt?.toISOString() ?? null,
                learned: !!entry.final.learnedAt,
                channel: {
                  id: entry.final.integrationId,
                  name: integration?.name || '',
                  platform,
                },
                textDiff: entry.diff!.textDiff,
                itemsAdded: entry.diff!.itemsAdded,
                itemsRemoved: entry.diff!.itemsRemoved,
                mediaAdded: entry.diff!.media.added,
                mediaRemoved: entry.diff!.media.removed,
                mediaReordered: entry.diff!.media.reordered,
                settingsChanged: entry.diff!.settingsChanged,
                ...(entry.diff!.scheduleChange
                  ? { scheduleChange: entry.diff!.scheduleChange }
                  : {}),
              };
            });

          return { total: posts.length, posts };
        } catch (err) {
          return {
            error: `Failed to read post history: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
