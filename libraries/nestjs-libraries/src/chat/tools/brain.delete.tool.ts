import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BrainService } from '@gitroom/nestjs-libraries/database/prisma/brain/brain.service';

@Injectable()
export class BrainDeleteTool implements AgentToolInterface {
  constructor(private _brainService: BrainService) {}
  name = 'brainDeleteTool';

  run() {
    return createTool({
      id: 'brainDeleteTool',
      description: `Delete a document from the agent brain, with everything written in it. This cannot be undone, so say what you are removing.
Only user-created documents and your own Experience can be deleted. The Foundation documents and the per-channel documents are part of the product and will be refused; to empty one of those, use brainSaveTool with an empty list of rules instead.
Retire an Experience document when what is in it turned out to be wrong or no longer applies. A lesson you no longer stand behind is worse than no lesson.`,
      mcp: {
        annotations: {
          title: 'Delete Agent Brain Document',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        category: z.string().describe('The category of the document'),
        key: z.string().describe('The key of the document to delete'),
      }),
      outputSchema: z.object({
        deleted: z.boolean().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          await this._brainService.deleteDocument(
            organizationId,
            inputData.category,
            inputData.key,
            true
          );

          return { deleted: true };
        } catch (err) {
          return {
            error: `Failed to delete the document: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
