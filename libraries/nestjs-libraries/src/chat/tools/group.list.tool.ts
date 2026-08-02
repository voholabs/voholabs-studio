import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class GroupListTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'groupList';

  run() {
    return createTool({
      id: 'groupList',
      description: `Lists the customers of this account. A customer is an optional label used to group channels, so that an agency can keep one client's channels apart from another's. Use a customer id with the integrationList tool to see only that customer's channels.
An empty list is normal and is not a problem: it only means no customer has been created yet, and every channel simply belongs to the account itself. This has nothing to do with the account's team or its members, so do not report it as the user having no team.`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'List Groups',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        return {
          output: (await this._integrationService.customers(organizationId)).map(
            (p) => ({
              id: p.id,
              name: p.name,
            })
          ),
        };
      },
    });
  }
}
