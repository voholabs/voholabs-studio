import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  organizationIdFromContext,
  runSanityTool,
  SANITY_MCP_DOCS_URL,
  SANITY_MCP_READ_TOOLS,
} from '@gitroom/nestjs-libraries/chat/tools/sanity.mcp.shared';

@Injectable()
export class SanityReadTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'sanityRead';

  run() {
    return createTool({
      id: 'sanityRead',
      description: `Reads from this workspace's connected Sanity CMS project by running one of Sanity's read-only MCP tools (${[
        ...SANITY_MCP_READ_TOOLS,
      ].join(', ')}).
      Calls the Sanity MCP server, see ${SANITY_MCP_DOCS_URL}. Nothing here changes a document; use sanityWrite to create, edit or publish.
      Pass the tool name exactly as sanityMcpList reported it and an arguments object matching the inputSchema it reported.
      Omit the Sanity project id and dataset - Studio fills those in from the connected channel.`,
      mcp: {
        annotations: {
          title: 'Read Sanity Content',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            `The Sanity read tool to run, one of: ${[...SANITY_MCP_READ_TOOLS].join(', ')}`
          ),
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
        return runSanityTool(
          this._integrationService,
          organizationIdFromContext(context),
          'sanityRead',
          inputData.name,
          inputData.arguments || {}
        );
      },
    });
  }
}
