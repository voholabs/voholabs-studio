import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';

@Injectable()
export class BriefStatusTool implements AgentToolInterface {
  constructor(private _briefService: BriefService) {}
  name = 'briefStatus';

  run() {
    return createTool({
      id: 'briefStatus',
      description: `Which documents of the brief are filled in: the Foundation documents and one per connected channel (category "channels", key = the channel's id), each with "filled" and how many asset files it has. "done" is true when every one is filled.
briefListTool reads a document's content and briefSaveTool saves one.`,
      mcp: {
        annotations: {
          title: 'Brief Status',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        done: z.boolean().optional(),
        documents: z
          .array(
            z.object({
              category: z.string(),
              key: z.string(),
              label: z.string(),
              description: z.string(),
              filled: z.boolean(),
              files: z.number(),
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
          return await this._briefService.onboardingStatus(organizationId);
        } catch (err) {
          return {
            error: 'Could not read the brief right now. Try again shortly.',
          };
        }
      },
    });
  }
}
