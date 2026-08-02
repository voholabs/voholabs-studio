import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class AccountInfoTool implements AgentToolInterface {
  name = 'accountInfo';

  run() {
    return createTool({
      id: 'accountInfo',
      description: `Says which account this connection belongs to: the organization (also called the team or workspace) and the instance it lives on.
Use it whenever the user asks what they are connected to, which account or team is in use, or whether this is the live site or a test one. Worth checking before anything that publishes or deletes, so the right account is confirmed first.
Note this is the account itself, which is different from the customers returned by groupList — those are optional labels for grouping channels.`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'Account Info',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        id: z.string().describe('The organization id'),
        name: z.string().describe('The organization (team) name'),
        instance: z
          .string()
          .optional()
          .describe(
            'The site this account lives on, which distinguishes the live instance from a test one'
          ),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organization = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );

          return {
            id: organization.id,
            name: organization.name,
            instance: process.env.FRONTEND_URL,
          };
        } catch (err) {
          return {
            id: '',
            name: '',
            error: 'Could not read the account behind this connection.',
          };
        }
      },
    });
  }
}
