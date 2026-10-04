// placeholder: replaced by stream S4 at merge
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import {
  checkAuth,
  paidOnly,
} from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class SkillsListTool implements AgentToolInterface {
  name = 'skillsList';

  run() {
    return createTool({
      id: 'skillsList',
      description: 'List the skills in the skills library.',
      inputSchema: z.object({
        tag: z.string().optional(),
        search: z.string().optional(),
      }),
      outputSchema: z.object({
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const blocked = paidOnly(context, 'The skills library', 'skills');
        return { error: blocked || 'The skills library is not available yet.' };
      },
    });
  }
}
