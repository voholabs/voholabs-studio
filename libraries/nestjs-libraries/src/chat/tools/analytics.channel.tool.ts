import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { Organization } from '@prisma/client';

@Injectable()
export class AnalyticsChannelTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'channelAnalyticsTool';

  run() {
    return createTool({
      id: 'channelAnalyticsTool',
      description: `How a channel itself is doing: followers, impressions, engagement and whatever else that network reports about the account.
Use integrationList first to get the channel id. Only social channels report analytics; publishing platforms such as a blog or a newsletter return nothing, which is expected rather than an error.
What comes back differs by network, because each one exposes its own metrics. Read the labels rather than assuming a fixed set, and say which network the numbers came from.
Numbers can be a day or two behind what the network's own dashboard shows, so do not present them as live.`,
      mcp: {
        annotations: {
          title: 'Channel Analytics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        id: z.string().describe('The channel id, from integrationList'),
        days: z
          .number()
          .optional()
          .describe('How many days back to look. Defaults to 30.'),
      }),
      outputSchema: z.object({
        analytics: z.any().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organization = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ) as Organization;

          const analytics = await this._integrationService.checkAnalytics(
            organization,
            inputData.id,
            String(inputData.days ?? 30)
          );

          if (!analytics?.length) {
            return {
              analytics: [],
              error:
                'No analytics for this channel. Either the network reports none for this account type, or it is a publishing platform rather than a social one.',
            };
          }

          return { analytics };
        } catch (err) {
          return {
            error: `Failed to read channel analytics: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
