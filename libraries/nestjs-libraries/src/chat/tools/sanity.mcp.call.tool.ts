import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  organizationIdFromContext,
  readJsonSchema,
  resolveSanityCredentials,
  SANITY_MCP_ALLOWLIST,
  SANITY_MCP_FORBIDDEN_ARGUMENT,
  SANITY_MCP_NOT_ALLOWED,
  SANITY_MCP_NOT_CONNECTED,
  SANITY_MCP_SCHEDULING_REFUSAL,
  scopeArgumentsToChannel,
  withSanityMcp,
} from '@gitroom/nestjs-libraries/chat/tools/sanity.mcp.shared';

@Injectable()
export class SanityMcpCallTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'sanityMcpCall';

  run() {
    return createTool({
      id: 'sanityMcpCall',
      description: `Runs one of the Sanity CMS tools listed by sanityMcpList against this workspace's connected Sanity channel.
      Pass the tool name exactly as sanityMcpList reported it and an arguments object matching the inputSchema it reported.
      Omit the Sanity project id and dataset - Studio fills those in from the connected channel.
      Tools that sanityMcpList did not report are refused, so check the list rather than guessing a name.`,
      mcp: {
        annotations: {
          title: 'Call Sanity Tool',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        name: z
          .string()
          .describe('The Sanity tool name, exactly as sanityMcpList reported it'),
        arguments: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Arguments for the tool, matching the inputSchema from sanityMcpList. Leave out `resource`.'
          ),
      }),
      outputSchema: z.object({
        output: z.any(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = organizationIdFromContext(context);

        // The allowlist is enforced here and not only in sanityMcpList.
        // Filtering the list is discoverability; this is the control. A model
        // that has seen a tool name once will try it.
        if (!SANITY_MCP_ALLOWLIST.has(inputData.name)) {
          return { output: SANITY_MCP_NOT_ALLOWED(inputData.name) };
        }

        const args = inputData.arguments || {};

        // `releaseId` turns an allowed write into a scheduled one. See the note
        // in sanity.mcp.shared.ts.
        if (args[SANITY_MCP_FORBIDDEN_ARGUMENT] !== undefined) {
          return { output: SANITY_MCP_SCHEDULING_REFUSAL };
        }

        const credentials = await resolveSanityCredentials(
          this._integrationService,
          organizationId
        );

        if (!credentials) {
          return { output: SANITY_MCP_NOT_CONNECTED };
        }

        try {
          return await withSanityMcp(credentials, async (tools) => {
            const tool = tools[inputData.name];

            if (!tool?.execute) {
              return {
                output: `Sanity does not expose a tool called "${inputData.name}". Call sanityMcpList for the current list.`,
              };
            }

            const output = await tool.execute(
              scopeArgumentsToChannel(
                args,
                readJsonSchema(tool.inputSchema),
                credentials
              ),
              {}
            );

            return { output };
          });
        } catch (err) {
          // The token itself is never in the message, and never logged.
          return {
            output: `Sanity refused the call: ${
              err instanceof Error ? err.message : 'unexpected error'
            }`,
          };
        }
      },
    });
  }
}
