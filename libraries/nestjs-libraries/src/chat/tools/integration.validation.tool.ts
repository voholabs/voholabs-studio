import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationValidationTool implements AgentToolInterface {
  constructor(private _integrationManager: IntegrationManager) {}
  name = 'integrationSchema';

  run() {
    return createTool({
      id: 'integrationSchema',
      description: `Returns the schema of a platform's integration: the rules, the maximum length and the settings a post to it takes when it is scheduled.
         Some settings take an id (a tag, a list, a board) that comes from one of the returned 'tools', run through the triggerTool function.
         The 'tools' can also include a mention lookup, which finds the people or pages that can be tagged in the post content.
        `,
      mcp: {
        annotations: {
          title: 'Get Integration Schema',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        isPremium: z
          .boolean()
          .optional()
          .describe(
            'Only matters for X: whether the account is X Premium (longer posts). Defaults to false and has no effect on other platforms.'
          ),
        platform: z
          .string()
          .describe(
            `platform identifier (${socialIntegrationList
              .map((p) => p.identifier)
              .join(', ')})`
          ),
      }),
      outputSchema: z.object({
        output: z.object({
          rules: z.string(),
          maxLength: z
            .number()
            .describe('The maximum length of a post / comment'),
          settings: z
            .any()
            .describe('List of settings need to be passed to schedule a post'),
          tools: z
            .array(
              z.object({
                description: z.string().describe('Description of the tool'),
                methodName: z
                  .string()
                  .describe('Method to call to get the information'),
                dataSchema: z
                  .array(
                    z.object({
                      key: z
                        .string()
                        .describe('Name of the settings key to pass'),
                      description: z
                        .string()
                        .describe('Description of the setting key'),
                      type: z.string(),
                    })
                  )
                  .describe(
                    'This will be passed to integrationSchedulePostTool [output:settings]'
                  ),
              })
            )
            .describe(
              "Some settings take an id, tags or similar values that come from these tools, run through the `triggerTool` function [output:callable-tools]"
            ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const integration = socialIntegrationList.find(
          (p) => p.identifier === inputData.platform
        )!;

        if (!integration) {
          return {
            output: { rules: '', maxLength: 0, settings: {}, tools: [] },
          };
        }

        const maxLength = integration.maxLength(inputData.isPremium ?? false);
        const schemas = !integration.dto
          ? false
          : getValidationSchemas()[integration.dto.name];
        const tools = this._integrationManager.getAllTools();
        const rules = this._integrationManager.getAllRulesDescription();

        return {
          output: {
            rules: rules[integration.identifier],
            maxLength,
            settings: !schemas ? 'No additional settings required' : schemas,
            tools: tools[integration.identifier],
          },
        };
      },
    });
  }
}
