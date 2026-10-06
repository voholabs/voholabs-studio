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
  SANITY_MCP_WRITE_TOOLS,
} from '@gitroom/nestjs-libraries/chat/tools/sanity.mcp.shared';

@Injectable()
export class SanityWriteTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'sanityWrite';

  run() {
    return createTool({
      id: 'sanityWrite',
      description: `Creates, edits or publishes documents in this workspace's connected Sanity CMS project by running one of Sanity's write MCP tools (${[
        ...SANITY_MCP_WRITE_TOOLS,
      ].join(', ')}).
      Calls the Sanity MCP server, see ${SANITY_MCP_DOCS_URL}. create_documents and patch_documents work on drafts; publish_documents publishes now.
      Scheduling is Studio's job - use findSlotTool and integrationSchedulePostTool for anything with a time on it. Reads go through sanityRead.
      Pass the tool name exactly as sanityMcpList reported it and an arguments object matching the inputSchema it reported.
      Omit the Sanity project id and dataset - Studio fills those in from the connected channel.`,
      mcp: {
        annotations: {
          title: 'Write Sanity Content',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            `The Sanity write tool to run, one of: ${[...SANITY_MCP_WRITE_TOOLS].join(', ')}`
          ),
        arguments: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Arguments for the tool, matching the inputSchema from sanityMcpList. Leave out `resource` and `releaseId`.'
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
          'sanityWrite',
          inputData.name,
          inputData.arguments || {}
        );
      },
    });
  }
}
