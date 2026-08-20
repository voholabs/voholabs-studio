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
  SANITY_MCP_NOT_CONNECTED,
  withSanityMcp,
} from '@gitroom/nestjs-libraries/chat/tools/sanity.mcp.shared';

@Injectable()
export class SanityMcpListTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'sanityMcpList';

  run() {
    return createTool({
      id: 'sanityMcpList',
      description: `Lists the Sanity CMS tools available for this workspace's connected Sanity channel, with the arguments each one takes.
      Call this before sanityMcpCall so you pass the right arguments; call sanityMcpCall to actually run one.
      The list is filtered: reading, creating, patching and publishing content is available, while scheduling, dataset and project administration and schema deploys are not.
      Scheduling in particular is Studio's job - use findSlotTool and integrationSchedulePostTool for anything with a time on it.
      You never need to supply the Sanity project id or dataset; Studio fills those in from the connected channel.`,
      mcp: {
        annotations: {
          title: 'List Sanity Tools',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        output: z.union([
          z.string(),
          z.object({
            projectId: z.string(),
            dataset: z.string(),
            tools: z.array(
              z.object({
                name: z.string(),
                description: z.string(),
                inputSchema: z
                  .any()
                  .describe(
                    'JSON Schema for the `arguments` object to pass to sanityMcpCall'
                  ),
              })
            ),
          }),
        ]),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = organizationIdFromContext(context);

        const credentials = await resolveSanityCredentials(
          this._integrationService,
          organizationId
        );

        if (!credentials) {
          return { output: SANITY_MCP_NOT_CONNECTED };
        }

        try {
          return await withSanityMcp(credentials, async (tools) => ({
            output: {
              projectId: credentials.projectId,
              dataset: credentials.dataset,
              tools: Object.entries(tools)
                .filter(([name]) => SANITY_MCP_ALLOWLIST.has(name))
                .map(([name, tool]) => ({
                  name,
                  description: (tool as any)?.description || '',
                  inputSchema: readJsonSchema((tool as any)?.inputSchema),
                })),
            },
          }));
        } catch (err) {
          // The token itself is never in the message, and never logged.
          return {
            output: `Could not reach Sanity: ${
              err instanceof Error ? err.message : 'unexpected error'
            }`,
          };
        }
      },
    });
  }
}
