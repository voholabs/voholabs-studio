import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  BRIEF_KIT_COLOR_ROLES,
  BRIEF_KIT_FONT_ROLES,
  BRIEF_KIT_IMAGERY_MAX,
  BRIEF_KIT_LOGO_VARIANTS,
} from '@gitroom/nestjs-libraries/agent-brief/brief.registry';

@Injectable()
export class BriefSaveTool implements AgentToolInterface {
  constructor(private _briefService: BriefService) {}
  name = 'briefSaveTool';

  run() {
    return createTool({
      id: 'briefSaveTool',
      description: `Writes one document of the agent brief, the description of the business that steers everything published on its behalf.
The rules sent become the document's whole list of rules; a call without rules keeps the stored rules as they are. When the document already holds rules whose headings are not in the call, nothing is saved and the result lists those headings in "missing"; with replace: true they are dropped instead. briefListTool returns the current rules, and the valid categories and keys.
Each rule is a heading and the plain text under it. Markdown or HTML in a rule (# headings, bullets, tables, bold) is stored and shown literally, so it reads as broken text rather than as formatting. The headings are the document's structure, one rule per idea.
For the branding-assets document, "kit" sets the structured brand kit: colours by role, Google Fonts families by role, logo files by variant and a one-line imagery style. Each kit field sent replaces that field, fields left out stay as stored, and an empty list or empty imagery line clears that field. The result returns the kit as stored.
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
          .optional()
          .describe(
            'The rules of this document, one rule per idea. They become its whole list of rules. Left out, the stored rules stay as they are.'
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
        kit: z
          .object({
            colors: z
              .array(
                z.object({
                  role: z.enum(BRIEF_KIT_COLOR_ROLES),
                  hex: z.string().describe('Six hex digits, like #0E1A2B'),
                })
              )
              .optional()
              .describe('One colour per role'),
            fonts: z
              .array(
                z.object({
                  role: z.enum(BRIEF_KIT_FONT_ROLES),
                  family: z
                    .string()
                    .describe(
                      'A Google Fonts family name, like "Inter" or "Playfair Display"'
                    ),
                })
              )
              .optional()
              .describe('One font per role'),
            logos: z
              .array(
                z.object({
                  variant: z
                    .enum(BRIEF_KIT_LOGO_VARIANTS)
                    .describe(
                      'light: the logo for light backgrounds. dark: the logo for dark backgrounds. icon: the square mark.'
                    ),
                  url: z
                    .string()
                    .describe(
                      'The media-library path of the file (as returned by the upload tools), or a link to it'
                    ),
                })
              )
              .optional()
              .describe('One logo per variant'),
            imagery: z
              .string()
              .optional()
              .describe(
                `One line on how the photos and illustrations look, up to ${BRIEF_KIT_IMAGERY_MAX} characters`
              ),
          })
          .optional()
          .describe(
            'branding-assets only: the structured brand kit. Each field sent replaces that field; fields left out stay as stored.'
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
        kit: z
          .any()
          .optional()
          .describe('The brand kit as stored after this call'),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          if (
            !inputData.rules &&
            !inputData.links &&
            !inputData.kit &&
            inputData.title === undefined
          ) {
            return {
              error:
                'Not saved: the call holds no rules, links, kit or title to write.',
            };
          }

          const problem =
            inputData.kit &&
            this._briefService.kitProblem(
              inputData.category,
              inputData.key,
              inputData.kit
            );
          if (problem) {
            return { error: problem };
          }

          if (inputData.rules && !inputData.replace) {
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
              ...(inputData.rules
                ? {
                    blocks: inputData.rules.map((rule) => ({
                      id: makeId(10),
                      heading: rule.heading,
                      body: rule.body,
                    })),
                  }
                : {}),
              ...(inputData.links
                ? {
                    links: inputData.links.map((link) => ({
                      id: makeId(10),
                      url: link.url,
                      note: link.note || '',
                    })),
                  }
                : {}),
              ...(inputData.kit ? { kit: inputData.kit } : {}),
            }
          );

          return {
            saved: true,
            category: saved.category,
            key: saved.key,
            rules: saved.content.blocks.length,
            ...(saved.content.kit ? { kit: saved.content.kit } : {}),
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
