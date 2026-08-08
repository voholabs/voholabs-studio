import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';
import { BRIEF_REGISTRY } from '@gitroom/nestjs-libraries/agent-brief/brief.registry';

@Injectable()
export class BriefListTool implements AgentToolInterface {
  constructor(private _briefService: BriefService) {}
  name = 'briefListTool';

  run() {
    return createTool({
      id: 'briefListTool',
      description: `Read the agent brief: everything the user has written about their business — what they do, who they are for, how they sound, what is off limits, how each channel should be steered, and which sources to draw on.
Read this before writing anything on the user's behalf, so the content matches their business rather than generic advice.
It returns both the schema (which categories and documents exist, and which of them can be created or deleted) and the content the user has filled in so far. A document that has never been written to simply will not appear in "documents".
Each document is a list of rules: a heading and the text under it.`,
      mcp: {
        annotations: {
          title: 'Read Agent Brief',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe(
            'Only return documents of one category: foundation, sources or channels. Omit for everything.'
          ),
      }),
      outputSchema: z.object({
        schema: z.any().optional(),
        documents: z.any().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const { documents } = await this._briefService.getDocuments(
            organizationId
          );

          return {
            schema: BRIEF_REGISTRY.map((category) => ({
              category: category.id,
              label: category.label,
              canCreate: !!category.canCreate,
              canDelete: !!category.canDelete,
              documents: (category.documents || []).map((document) => ({
                key: document.key,
                label: document.label,
                description: document.description,
              })),
            })),
            documents: inputData.category
              ? documents.filter((one) => one.category === inputData.category)
              : documents,
          };
        } catch (err) {
          return {
            error: `Failed to read the brief: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
