import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import {
  checkAuth,
  paidOnly,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { SkillsService } from '@gitroom/nestjs-libraries/database/prisma/skills/skills.service';

@Injectable()
export class SkillsListTool implements AgentToolInterface {
  constructor(private _skills: SkillsService) {}
  name = 'skillsList';

  run() {
    return createTool({
      id: 'skillsList',
      description: `List the Studio skills library: ready-made instructions for common jobs (articles, posts for each channel, hooks, images, videos, tips and tricks). Each skill says when to use it and which Studio tools it relies on.
Check this before starting a content task: if a skill fits, read it with skillGet and follow it. Filter by tag (a key from "tags") or search by words. Using skills is free.`,
      mcp: {
        annotations: {
          title: 'List Skills',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        tag: z
          .string()
          .optional()
          .describe('Only skills with this tag key, e.g. "writing"'),
        search: z
          .string()
          .optional()
          .describe('Words to look for in the skill name, summary or tags'),
      }),
      outputSchema: z.object({
        tags: z
          .array(z.object({ key: z.string(), label: z.string() }))
          .optional(),
        skills: z
          .array(
            z.object({
              slug: z.string(),
              name: z.string(),
              summary: z.string(),
              tags: z.array(z.string()),
              tools: z.array(z.string()),
              whenToUse: z.string().nullable(),
            })
          )
          .optional(),
        hint: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const blocked = paidOnly(context, 'The skills library', 'skills');
        if (blocked) {
          return { error: blocked };
        }
        try {
          const { tags, skills } = await this._skills.list({
            tag: inputData.tag,
            search: inputData.search,
          });
          return {
            tags,
            skills,
            hint: skills.length
              ? 'Use skillGet with a slug for the full instructions.'
              : 'No skills match. Try another tag or search, or omit both to see every skill.',
          };
        } catch (err) {
          return {
            error:
              'Could not read the skills library right now. Try again shortly.',
          };
        }
      },
    });
  }
}
