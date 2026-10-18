import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

@Injectable()
export class BriefSaveTool implements AgentToolInterface {
  constructor(private _briefService: BriefService) {}
  name = 'briefSaveTool';

  run() {
    return createTool({
      id: 'briefSaveTool',
      description: `Writes one document of the agent brief, the description of the business that steers everything published on its behalf.
The rules sent become the document's whole list of rules. When the document already holds rules whose headings are not in the call, nothing is saved and the result lists those headings in "missing"; with replace: true they are dropped instead. briefListTool returns the current rules, and the valid categories and keys.
Each rule is a heading and the plain text under it. Markdown or HTML in a rule (# headings, bullets, tables, bold) is stored and shown literally, so it reads as broken text rather than as formatting. The headings are the document's structure, one rule per idea.
In the sources category each document is one source: a single place to read from, with its own short key and title ("forum", "discord", "notion") and its address in "links", with a note on what the link is and when it applies. The link is the source; the rules say how it is used.
Experience lessons are kept by briefLearnTool, one lesson at a time.
A new key can be created only in a category marked canCreate; the other categories accept their existing keys.`,
      mcp: {
        annotations: {
          title: 'Write Agent Brief',
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
          .describe(
            'foundation, sources or channels (listed by briefListTool)'
          ),
        key: z
          .string()
          .describe(
            'The document key. For channels it is the integration id. For a source it is a short unique key naming that one source ("forum", "notion"); each source has its own document.'
          ),
        title: z
          .string()
          .optional()
          .describe('Name of the document. Only used by user-created sources.'),
        rules: z
          .array(
            z.object({
              heading: z.string().describe('What this rule is about'),
              body: z
                .string()
                .describe(
                  'The rule itself, as plain text. No markdown or HTML: it is stored and rendered as written.'
                ),
            })
          )
          .describe(
            'The rules of this document, one rule per idea. They become its whole list of rules.'
          ),
        links: z
          .array(
            z.object({
              url: z.string(),
              note: z
                .string()
                .optional()
                .describe('What this link is and when it applies'),
            })
          )
          .optional()
          .describe(
            'Sources category only: the addresses this source is read from.'
          ),
        replace: z
          .boolean()
          .optional()
          .describe(
            'Set to true to drop the existing rules not sent in this call'
          ),
      }),
      outputSchema: z.object({
        saved: z.boolean().optional(),
        category: z.string().optional(),
        key: z.string().optional(),
        rules: z.number().optional(),
        error: z.string().optional(),
        missing: z.array(z.string()).optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          if (!inputData.replace) {
            const missing = await this._briefService.missingHeadings(
              organizationId,
              inputData.category,
              inputData.key,
              inputData.rules.map((rule: { heading: string }) => rule.heading)
            );

            if (missing.length) {
              const named = missing.map((heading) => `"${heading}"`).join(', ');
              return {
                error: `Not saved: this document already holds rules that this call leaves out (${named}), and saving would remove them. Sending them again with the rest keeps them; replace: true drops them on purpose.`,
                missing,
              };
            }
          }

          const saved = await this._briefService.saveDocument(
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
            error: `Failed to write the brief: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
