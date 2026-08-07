import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BrainService } from '@gitroom/nestjs-libraries/database/prisma/brain/brain.service';

@Injectable()
export class BrainAssetTool implements AgentToolInterface {
  constructor(private _brainService: BrainService) {}
  name = 'brainAssetTool';

  run() {
    return createTool({
      id: 'brainAssetTool',
      description: `Register a brand file — a logo, a product shot, a video — in Branding & assets, so it is on hand the next time something is made for this brand.
Get the file into the media library first (uploadFromUrlTool, uploadMediaTool or createUploadLinkTool) and pass the "path" it returns as the url. Files uploaded that way already live in the account's own storage.
Always write a note saying when to reach for this file and when not to — a logo on a dark background, a shot that is only for launches, a video that must never be cropped. A file with no note is nearly useless later.`,
      mcp: {
        annotations: {
          title: 'Register Brand Asset',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        name: z.string().describe('What this file is called'),
        url: z
          .string()
          .describe('The media library path, or a URL the file already lives at'),
        mime: z
          .string()
          .optional()
          .describe('Content type, e.g. image/png or video/mp4'),
        note: z
          .string()
          .describe('When to use this file, and when not to'),
      }),
      outputSchema: z.object({
        registered: z.boolean().optional(),
        assets: z.number().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          const saved = await this._brainService.registerAsset(organizationId, {
            name: inputData.name,
            url: inputData.url,
            mime: inputData.mime,
            note: inputData.note,
          });

          return { registered: true, assets: saved.assets };
        } catch (err) {
          return {
            error: `Failed to register the file: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
