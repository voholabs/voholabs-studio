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
export class FlowShareTool implements AgentToolInterface {
  constructor(private _userFlows: UserFlowsService) {}
  name = 'flowShare';

  run() {
    return createTool({
      id: 'flowShare',
      description: `Turns the share link of one of this workspace's own flows on ("create", which returns the live link when there is one already) or off ("revoke"). A share link opens a Studio page, for anyone signed in, with the method and an import into their own flows; it carries no brand of this workspace. Returns the url and token, or whether a live link was revoked. Included with Plus.`,
      mcp: {
        annotations: {
          title: 'Share My Flow',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        slug: z.string().min(1).max(100).describe('The flow slug, from flowsList'),
        action: z.enum(['create', 'revoke']),
      }),
      outputSchema: z.object({
        url: z.string().optional().describe('The share page'),
        token: z.string().optional(),
        revoked: z.boolean().optional(),
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
          return inputData.action === 'revoke'
            ? await this._userFlows.revoke(org.id, inputData.slug)
            : await this._userFlows.share(org.id, inputData.slug);
        } catch (err) {
          return flowError(err);
        }
      },
    });
  }
}
