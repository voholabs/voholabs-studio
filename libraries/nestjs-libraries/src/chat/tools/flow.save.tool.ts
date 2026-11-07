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
import {
  USER_FLOW_BASED_ON,
  USER_FLOW_BASED_ON_MAX,
  USER_FLOW_BODY_MAX,
  USER_FLOW_CATEGORY_MAX,
  USER_FLOW_CUSTOMIZATION_MAX,
  USER_FLOW_COST_MAX,
  USER_FLOW_LIBRARY_ID_MAX,
  USER_FLOW_LIST_ITEM_MAX,
  USER_FLOW_LIST_MAX,
  USER_FLOW_SKILL_SLUG_MAX,
  USER_FLOW_SKILLS_MAX,
  USER_FLOW_SLUG,
  USER_FLOW_SLUG_MAX,
  USER_FLOW_TEXT_MAX,
  USER_FLOW_TITLE_MAX,
  USER_FLOW_TOKEN_MAX,
} from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

// Only served to the MCP gateway (gatewayToolList).
@Injectable()
export class FlowSaveTool implements AgentToolInterface {
  constructor(private _userFlows: UserFlowsService) {}
  name = 'flowSave';

  run() {
    return createTool({
      id: 'flowSave',
      description: `Saves a flow to this workspace's own flows. A slug that exists updates that flow (fields left out keep their stored value); no slug, or a new one, creates a flow. "forkOf" records the library flow a copy came from and creates a new flow. "basedOn" makes a custom flow: it names the flow it is based on (a library flow id or "my/<slug>"), the base is read each time the flow is read, and "customization" holds what changes or adds to it. A new flow has a title and a body or a base. A skill link in the body, the customization or a part, "[Skill: Name](skill:<slug>)", brings in a skill from the skills library by its slug, or one of this workspace's own skills as "skill:my/<slug>"; "skills" adds skills by the same references without a link. A flow brings in at most 10 skills in all; a reference that names no skill is refused, and the error lists the workspace's own skills. The workspace's own skills are written in the app; this tool does not create them. "importToken" copies the flow behind a share link as a new flow, with the author's colour codes, media links and Studio name scrubbed out, and copies the author's own skills it brings in to this workspace's own skills; title and body are then optional. A flow holds the method only: brand details found in it come back as warnings and the flow is saved either way. Returns the slug, whether it was created, and the warnings. Included with Plus.`,
      mcp: {
        annotations: {
          title: 'Save My Flow',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        slug: z
          .string()
          .max(USER_FLOW_SLUG_MAX)
          .regex(USER_FLOW_SLUG)
          .optional()
          .describe('Lower-case letters, digits and dashes; made from the title when left out'),
        title: z.string().min(1).max(USER_FLOW_TITLE_MAX).optional(),
        whenToUse: z.string().max(USER_FLOW_TEXT_MAX).optional(),
        summary: z.string().max(USER_FLOW_TEXT_MAX).optional(),
        body: z
          .string()
          .max(USER_FLOW_BODY_MAX)
          .optional()
          .describe('The method, in Markdown, with skill links "[Skill: Name](skill:<slug>)"'),
        parts: z
          .record(z.string(), z.string())
          .optional()
          .describe('Named parts of the method, { name: text }'),
        category: z.string().max(USER_FLOW_CATEGORY_MAX).optional(),
        foundation: z
          .array(z.string().max(USER_FLOW_LIST_ITEM_MAX))
          .max(USER_FLOW_LIST_MAX)
          .optional(),
        cost: z
          .string()
          .max(USER_FLOW_COST_MAX)
          .optional()
          .describe('The cost line, with {{credits ...}} placeholders'),
        brandSlots: z
          .array(z.string().max(40))
          .max(USER_FLOW_LIST_MAX)
          .optional()
          .describe('The brand kit fields the flow reads, e.g. "palette", "voice"'),
        forkOf: z
          .string()
          .max(USER_FLOW_LIBRARY_ID_MAX)
          .optional()
          .describe('The id of the library flow this is a copy of'),
        importToken: z
          .string()
          .max(USER_FLOW_TOKEN_MAX)
          .optional()
          .describe('The token of a share link to import'),
        basedOn: z
          .string()
          .max(USER_FLOW_BASED_ON_MAX)
          .regex(USER_FLOW_BASED_ON)
          .optional()
          .describe(
            'The flow this one is based on: a library flow id, or "my/<slug>" for one of these flows'
          ),
        customization: z
          .string()
          .max(USER_FLOW_CUSTOMIZATION_MAX)
          .optional()
          .describe('What changes or adds to the base method, in Markdown'),
        skills: z
          .array(z.string().max(USER_FLOW_SKILL_SLUG_MAX))
          .max(USER_FLOW_SKILLS_MAX)
          .optional()
          .describe(
            'Skills brought in without a link: skills library slugs, or "my/<slug>" for the workspace\'s own skills; at most 10 together with the linked ones'
          ),
      }),
      outputSchema: z.object({
        slug: z.string().optional(),
        created: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
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
        if (
          !inputData.importToken &&
          (!inputData.title ||
            (inputData.body === undefined && !inputData.basedOn))
        ) {
          return { error: 'A flow needs a title, and a body or a base.' };
        }
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );
        try {
          const { importToken, forkOf, ...input } = inputData;
          return await this._userFlows.save(org.id, input, {
            source: 'SAVED_FROM_CHAT',
            forkOf,
            importToken,
            overwrite: true,
          });
        } catch (err) {
          return flowError(err);
        }
      },
    });
  }
}
