import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import {
  checkAuth,
  paidOnly,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { UserFlowsService } from '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.service';
import {
  flowError,
  flowsLocked,
} from '@gitroom/nestjs-libraries/chat/tools/user.flows.shared';
import { plusUrl } from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

// Only served to the MCP gateway (gatewayToolList).
@Injectable()
export class FlowGetTool implements AgentToolInterface {
  constructor(private _userFlows: UserFlowsService) {}
  name = 'flowGet';

  run() {
    return createTool({
      id: 'flowGet',
      description: `Reads one of this workspace's own flows by its slug: the title, when to use it, the summary, category, cost line, foundation, the whole method ("body"), its named parts, the brand slots the reader's brand kit fills, how it was made and the origin it was forked from.
A custom flow comes back merged with the flows of this workspace it is based on: "basedOn" is the Voho library flow at the end of that chain (null when there is none), "customization" holds the changes oldest first and wins over the base method, "body" is the method of the chain's own first flow ("" when the chain ends in a library flow), and "parts" are merged with the nearer flow winning.
"skills" lists the skills the flow brings in, with their instructions in "body"; without the skills unlock each one is "locked" with no body and "skillsUpgradeUrl" is the Plus page; a skill no longer in the library is "missing". An unknown slug returns the error "flow not found". Included with Plus.`,
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
        basedOn: z
          .string()
          .nullable()
          .optional()
          .describe('The Voho library flow id the flow is based on'),
        customization: z
          .string()
          .optional()
          .describe('The changes to the base method, oldest first'),
        skills: z
          .array(
            z.object({
              slug: z.string(),
              name: z.string(),
              summary: z.string(),
              whenToUse: z.string().nullable(),
              body: z.string().optional(),
              locked: z.literal(true).optional(),
              missing: z.literal(true).optional(),
            })
          )
          .optional(),
        skillsUpgradeUrl: z
          .string()
          .optional()
          .describe('The Plus page, when a skill is locked'),
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
          const flow = await this._userFlows.resolved(org.id, inputData.slug, {
            // The skills a flow brings in open with the skills library.
            skillsUnlocked: !paidOnly(context, 'The skills library', 'skills'),
          });
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
            basedOn: flow.basedOn,
            customization: flow.customization,
            skills: flow.skills,
            ...(flow.skills.some((skill) => skill.locked)
              ? { skillsUpgradeUrl: plusUrl() }
              : {}),
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
