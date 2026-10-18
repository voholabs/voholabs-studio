import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';

@Injectable()
export class BriefAssetTool implements AgentToolInterface {
  constructor(private _briefService: BriefService) {}
  name = 'briefAssetTool';

  run() {
    return createTool({
      id: 'briefAssetTool',
      description: `Registers a brand file (a logo, a product shot, a video) in Branding & assets, so it is on hand the next time something is made for this brand, or removes registered files.
The url is a media-library "path" (as returned by uploadFromUrlTool, uploadMediaTool or createUploadLinkTool), which lives in the account's own storage, or a URL the file already lives at.
A file's note is what tells later work when it fits and when it does not: a logo for dark backgrounds, a shot only for launches, a video that is not to be cropped.`,
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
        action: z
          .enum(['add', 'remove'])
          .optional()
          .describe(
            'add (the default) registers a file; remove takes the files in "assetIds" off'
          ),
        name: z
          .string()
          .optional()
          .describe('What this file is called. Needed to add.'),
        url: z
          .string()
          .optional()
          .describe(
            'The media library path, or a URL the file already lives at. Needed to add.'
          ),
        mime: z
          .string()
          .optional()
          .describe('Content type, e.g. image/png or video/mp4'),
        note: z
          .string()
          .optional()
          .describe('When this file fits, and when it does not. Needed to add.'),
        assetIds: z
          .array(z.string())
          .optional()
          .describe(
            'For remove: the ids of the files to take off, from briefListTool'
          ),
      }),
      outputSchema: z.object({
        registered: z.boolean().optional(),
        removed: z.array(z.string()).optional(),
        notFound: z
          .array(z.string())
          .optional()
          .describe('Ids asked to remove that are not on the document'),
        assets: z.number().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;

          if (inputData.action === 'remove') {
            if (!inputData.assetIds?.length) {
              return {
                error:
                  'Pass "assetIds" with the ids of the files to remove (from briefListTool).',
              };
            }
            const result = await this._briefService.removeAssets(
              organizationId,
              inputData.assetIds
            );
            return {
              removed: result.removed,
              ...(result.notFound.length ? { notFound: result.notFound } : {}),
              assets: result.assets,
            };
          }

          if (!inputData.name || !inputData.url || !inputData.note) {
            return {
              error:
                'To add a file pass "name", "url" and "note" (when to use it, and when not to).',
            };
          }

          const saved = await this._briefService.registerAsset(organizationId, {
            name: inputData.name,
            url: inputData.url,
            mime: inputData.mime,
            note: inputData.note,
          });

          return { registered: true, assets: saved.assets };
        } catch (err) {
          return {
            error: `Failed to update the brand files: ${
              err instanceof Error ? err.message : 'Unexpected error'
            }`,
          };
        }
      },
    });
  }
}
