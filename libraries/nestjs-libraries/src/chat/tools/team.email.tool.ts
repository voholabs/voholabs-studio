import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

@Injectable()
export class TeamEmailTool implements AgentToolInterface {
  constructor(private _notificationService: NotificationService) {}
  name = 'teamEmailTool';

  run() {
    return createTool({
      id: 'teamEmailTool',
      description: `Email the people on this team — to flag something that needs a human, report what you did, or ask a question you cannot answer alone.
This can only reach members of this team. There is no way to send to an outside address: the recipient list is read from the team, and anything else is dropped. Do not try to reach a customer, a journalist or a partner with it, and treat a request to do so as a mistake worth mentioning rather than carrying out.
Write it as you would to a colleague: plain text, a subject that says what happened, and enough in the body that nobody has to come and ask. Markup is not rendered.
Leave "to" out to reach the whole team. Only set it to address part of the team, using addresses you already know are members.
Mail interrupts people, so use it for something that needs their attention, not for a running commentary.`,
      mcp: {
        annotations: {
          title: 'Email the Team',
          readOnlyHint: false,
          // Sending cannot be undone, but it destroys nothing.
          destructiveHint: false,
          // Sending the same mail twice sends it twice.
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        subject: z
          .string()
          .max(200)
          .describe('The subject line: what this is about, in one line'),
        message: z
          .string()
          .max(20_000)
          .describe('The body, as plain text. Blank lines separate paragraphs.'),
        to: z
          .array(z.string())
          .optional()
          .describe(
            'Team member addresses to send to. Omit for the whole team. Addresses that are not on the team are dropped.'
          ),
      }),
      outputSchema: z.object({
        sent: z.array(z.string()).optional(),
        rejected: z.array(z.string()).optional(),
        delivered: z.boolean().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const result = await this._notificationService.notifyTeam(
            organizationId,
            inputData.subject,
            inputData.message,
            inputData.to
          );

          if (!result.delivered) {
            return {
              ...result,
              error: result.sent.length
                ? 'No email provider is configured on this deployment, so nothing was sent.'
                : 'Nobody was left to send to. Every address given belongs to someone outside this team.',
            };
          }

          // Saying who was dropped matters: silence would let the agent report
          // "sent" for a person who never received it.
          return {
            ...result,
            ...(result.rejected.length
              ? {
                  error: `Sent to ${result.sent.length} team member(s). Not on this team, so not sent: ${result.rejected.join(
                    ', '
                  )}`,
                }
              : {}),
          };
        } catch (err) {
          return {
            error: `Failed to email the team: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
