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

// Only served to the MCP gateway (gatewayToolList).
@Injectable()
export class FlowGetTool implements AgentToolInterface {
  constructor(private _userFlows: UserFlowsService) {}
  name = 'flowGet';

  run() {
    return createTool({
      id: 'flowGet',
      description: `Reads one of this workspace's own flows by its slug: the title, when to use it, the summary, category, cost line, foundation, the whole method ("body"), its named parts, the brand slots the reader's brand kit fills, how it was made and the origin it was forked from. An unknown slug returns the error "flow not found". Included with Plus.`,
      mcp: {
        annotations: {
          title: 'Read My Flow',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        slug: z.string().min(1).max(100).describe('The flow slug, from flowsList'),
      }),
      outputSchema: z.object({
        slug: z.string().optional(),
        title: z.string().optional(),
        whenToUse: z.string().optional(),
        summary: z.string().optional(),
        category: z.string().nullable().optional(),
        cost: z.string().nullable().optional(),
        foundation: z.array(z.string()).optional(),
        body: z.string().optional(),
        parts: z.record(z.string(), z.string()).nullable().optional(),
        brandSlots: z.array(z.string()).optional(),
        source: z
          .enum(['CREATED', 'FORKED', 'IMPORTED', 'SAVED_FROM_CHAT'])
          .optional(),
        forkedFromId: z.string().nullable().optional(),
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
          const flow = await this._userFlows.get(org.id, inputData.slug);
          if (!flow) {
            return { error: 'flow not found' };
          }
          return {
            slug: flow.slug,
            title: flow.title,
            whenToUse: flow.whenToUse,
            summary: flow.summary,
            category: flow.category,
            cost: flow.cost,
            foundation: flow.foundation,
            body: flow.body,
            parts: flow.parts,
            brandSlots: flow.brandSlots,
            source: flow.source,
            forkedFromId: flow.forkedFromId,
          };
        } catch (err) {
          return flowError(err);
        }
      },
    });
  }
}
