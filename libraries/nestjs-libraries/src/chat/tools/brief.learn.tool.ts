import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';

@Injectable()
export class BriefLearnTool implements AgentToolInterface {
  constructor(private _briefService: BriefService) {}
  name = 'briefLearnTool';

  run() {
    return createTool({
      id: 'briefLearnTool',
      description: `Records one lesson about what works for this brand in the Experience section of the agent brief.
Experience is the agent's own notebook of what it observed, separate from the user's instructions, which live in the Foundation. The user can edit any lesson there; an edited lesson is the user's correction.
Each call keeps one lesson. A heading already in the topic's document revises that lesson instead of adding a duplicate, so a lesson gets sharper over time rather than piling up.
A lesson that changes a future decision records what was tried, what happened, and what to do differently.
Lessons with the same "topic" share one document: one per channel, per format, per campaign, or another division.`,
      mcp: {
        annotations: {
          title: 'Record Agent Experience',
          readOnlyHint: false,
          // Revising a lesson replaces that one lesson's text; the previous
          // wording is not kept.
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        topic: z
          .string()
          .describe(
            'Short stable id for the document this lesson belongs in, e.g. "linkedin" or "launch-posts". Reuse it to keep related lessons together.'
          ),
        title: z
          .string()
          .optional()
          .describe('Human name for the document, set the first time a topic is used.'),
        heading: z
          .string()
          .describe(
            'What the lesson is about. Reusing a heading revises that lesson.'
          ),
        lesson: z
          .string()
          .describe(
            'The lesson as plain text: what was tried, what happened, what to do next time.'
          ),
      }),
      outputSchema: z.object({
        recorded: z.boolean().optional(),
        revised: z.boolean().optional(),
        topic: z.string().optional(),
        rules: z.number().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const saved = await this._briefService.recordExperience(
            organizationId,
            inputData.topic,
            { heading: inputData.heading, body: inputData.lesson },
            inputData.title
          );

          return {
            recorded: true,
            revised: saved.revised,
            topic: saved.key,
            rules: saved.rules,
          };
        } catch (err) {
          return {
            error: `Failed to record the lesson: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
