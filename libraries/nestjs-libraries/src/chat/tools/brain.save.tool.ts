import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BrainService } from '@gitroom/nestjs-libraries/database/prisma/brain/brain.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

@Injectable()
export class BrainSaveTool implements AgentToolInterface {
  constructor(private _brainService: BrainService) {}
  name = 'brainSaveTool';

  run() {
    return createTool({
      id: 'brainSaveTool',
      description: `Write to the agent brain — the description of the business that steers everything published on its behalf.
"rules" replaces the whole document, so always read the document with brainListTool first and send back the existing rules plus your changes — anything you leave out is deleted.
Each rule is a heading and the plain text under it; do not send markup.
Experience is not written here — use brainLearnTool, which revises one lesson at a time and needs no permission.
Use brainListTool for the list of valid categories and keys. Only documents in a category marked canCreate may be created with a new key; everything else must use a key that already exists.`,
      mcp: {
        annotations: {
          title: 'Write Agent Brain',
          readOnlyHint: false,
          // Replacing a document drops any rule left out of the call, so this
          // overwrites rather than accumulates.
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        category: z
          .string()
          .describe('foundation, sources or channels (from brainListTool)'),
        key: z
          .string()
          .describe(
            'The document key. For channels this is the integration id. For a new source document, invent a short unique key.'
          ),
        title: z
          .string()
          .optional()
          .describe('Name of the document. Only used by user-created sources.'),
        rules: z
          .array(
            z.object({
              heading: z.string().describe('What this rule is about'),
              body: z.string().describe('The rule itself, as plain text'),
            })
          )
          .describe(
            'The complete set of rules for this document. Anything omitted is removed.'
          ),
        links: z
          .array(
            z.object({
              url: z.string(),
              note: z
                .string()
                .optional()
                .describe('What this link is and how to use it'),
            })
          )
          .optional()
          .describe('Only for documents in the sources category.'),
      }),
      outputSchema: z.object({
        saved: z.boolean().optional(),
        category: z.string().optional(),
        key: z.string().optional(),
        rules: z.number().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const saved = await this._brainService.saveDocument(
            organizationId,
            inputData.category,
            inputData.key,
            {
              ...(inputData.title !== undefined
                ? { title: inputData.title }
                : {}),
              blocks: inputData.rules.map((rule) => ({
                id: makeId(10),
                heading: rule.heading,
                body: rule.body,
              })),
              ...(inputData.links
                ? {
                    links: inputData.links.map((link) => ({
                      id: makeId(10),
                      url: link.url,
                      note: link.note || '',
                    })),
                  }
                : {}),
            }
          );

          return {
            saved: true,
            category: saved.category,
            key: saved.key,
            rules: saved.content.blocks.length,
          };
        } catch (err) {
          return {
            error: `Failed to write the brain: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
