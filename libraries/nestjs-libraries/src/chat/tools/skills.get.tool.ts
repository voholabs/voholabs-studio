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
export class SkillGetTool implements AgentToolInterface {
  name = 'skillGet';

  run() {
    return createTool({
      id: 'skillGet',
      description: 'Read one skill from the skills library.',
      inputSchema: z.object({
        slug: z.string(),
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
