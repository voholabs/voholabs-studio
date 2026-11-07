import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { UserFlowsService } from '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.service';
import {
  flowError,
  flowsLocked,
} from '@gitroom/nestjs-libraries/chat/tools/user.flows.shared';

// Only served to the MCP gateway (gatewayToolList), which merges these into
// its own flow tools.
@Injectable()
export class FlowsListTool implements AgentToolInterface {
  constructor(private _userFlows: UserFlowsService) {}
  name = 'flowsList';

  run() {
    return createTool({
      id: 'flowsList',
      description: `Lists this workspace's own flows (My flows), the saved methods its agent can run. Each entry has the slug, title, when to use it, a summary, the category, the cost line, the foundation it reads, how it was made (CREATED, FORKED, IMPORTED or SAVED_FROM_CHAT), the flow it is based on ("basedOn": a library flow id, "my/<slug>" for another of these flows, or null), the skill slugs it brings in, the poster, whether it has a live share link and when it last changed. Included with Plus.`,
      mcp: {
        annotations: {
          title: 'List My Flows',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        flows: z
          .array(
            z.object({
              slug: z.string(),
              title: z.string(),
              whenToUse: z.string(),
              summary: z.string(),
              category: z.string().nullable(),
              cost: z.string().nullable(),
              foundation: z.array(z.string()),
              source: z.enum([
                'CREATED',
                'FORKED',
                'IMPORTED',
                'SAVED_FROM_CHAT',
              ]),
              basedOn: z.string().nullable(),
              skills: z.array(z.string()),
              poster: z.string().nullable(),
              shared: z.boolean(),
              updatedAt: z.string(),
            })
          )
          .optional(),
        error: z.string().optional(),
        code: z.literal('plus_required').optional(),
        upgradeUrl: z.string().optional().describe('The Plus page'),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const locked = flowsLocked(context);
        if (locked) {
          return locked;
        }
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );
        try {
          const flows = await this._userFlows.list(org.id);
          return {
            flows: flows.map((flow) => ({
              slug: flow.slug,
              title: flow.title,
              whenToUse: flow.whenToUse,
              summary: flow.summary,
              category: flow.category,
              cost: flow.cost,
              foundation: flow.foundation,
              source: flow.source,
              basedOn: flow.basedOn,
              skills: flow.skills,
              poster: flow.poster,
              shared: flow.shared,
              updatedAt: flow.updatedAt.toISOString(),
            })),
          };
        } catch (err) {
          return flowError(err);
        }
      },
    });
  }
}
