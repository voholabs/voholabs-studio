import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

@Injectable()
export class BriefDeleteTool implements AgentToolInterface {
  constructor(private _briefService: BriefService) {}
  name = 'briefDeleteTool';

  run() {
    return createTool({
      id: 'briefDeleteTool',
      description: `Deletes a document from the agent brief, with everything written in it. A deletion cannot be undone.
User-created documents and Experience documents can be deleted. The Foundation documents and the per-channel documents are part of the product and are refused; briefSaveTool with an empty list of rules and replace: true empties one of those.
This is also how an Experience document whose lessons turned out wrong, or no longer apply, is retired.
By default the document's history is deleted with it. keepHistory: true keeps its revisions and records the removal in them, so briefHistory still shows what was there.`,
      mcp: {
        annotations: {
          title: 'Delete Agent Brief Document',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        category: z.string().describe('The category of the document'),
        key: z.string().describe('The key of the document to delete'),
        keepHistory: z
          .boolean()
          .optional()
          .describe(
            'Keep the document history and record the removal in it, instead of wiping it (default false)'
          ),
      }),
      outputSchema: z.object({
        deleted: z.boolean().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organization = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          );

          // A paid plan is answered as before: a delete of a document that
          // is not there reports deleted.
          const { deleted } = await this._briefService.deleteDocument(
            organization.id,
            inputData.category,
            inputData.key,
            true,
            !!inputData.keepHistory,
            !hasAccess(organization)
          );

          if (!deleted) {
            return {
              deleted: false,
              error: `There is no "${inputData.key}" document in ${inputData.category}, so nothing was deleted. briefListTool lists the documents that exist.`,
            };
          }

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
