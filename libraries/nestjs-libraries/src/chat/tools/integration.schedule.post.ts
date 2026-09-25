import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AllProvidersSettings } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { Integration } from '@prisma/client';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  attachmentUrl,
  hostExternalAttachments,
  withPostLinks,
} from '@gitroom/nestjs-libraries/chat/tools/post.write.shared';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

@Injectable()
export class IntegrationSchedulePostTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService
  ) {}
  name = 'integrationSchedulePostTool';

  run() {
    return createTool({
      id: 'schedulePostTool',
      mcp: {
        annotations: {
          title: 'Schedule Social Media Post',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this when the user wants to create a draft, scheduled, or immediate social media post on their connected channels, based on the integrationSchema tool.
Examples of the input shape:

A single LinkedIn post with one comment
- socialPost array length will be one
- postsAndComments array length will be two (one for the post, one for the comment)

20 Facebook posts each on individual days without comments
- socialPost array length will be 20
- postsAndComments array length will be one

Do not use this to update or delete existing posts: use editPostTool or deletePostTool.
On success, each item in output contains a previewUrl the user can open to see the post.
If validation fails, the result contains output.errors describing what to fix; rerun it with the right parameters, don't ask again, just run it.

LINKING TO ANOTHER POST (echoing a post to other channels):
To put the live URL of another post inside this one, write "(post:<postId>)" in the
content. It is replaced with that post's real URL at the moment this post publishes,
so you CAN schedule "here is my new X post: <link>" before the X post exists.
- Get the postId from postsList, or from the output of a previous call to this tool.
- The referenced post must be scheduled EARLIER than this one.
- To echo a post you are creating now, call this tool twice: once for the original
  post, then again for the echo using the postId this tool returned.
- If the referenced post has not published by the time this one is due, this post
  waits for it, and fails instead of publishing a broken link. So an echo never goes
  out without its link.
- The reference expands to a full URL, so leave room for it in character limits.
`,
      inputSchema: z.object({
        socialPost: z
          .array(
            z.object({
              integrationId: z
                .string()
                .describe('The id of the integration (not internal id)'),
              isPremium: z
                .boolean()
                .describe(
                  "If the integration is X, return if it's premium or not"
                ),
              date: z.string().describe('The date of the post in UTC time'),
              shortLink: z
                .boolean()
                .describe(
                  'If the post has a link inside, we can ask the user if they want to add a short link'
                ),
              type: z
                .enum(['draft', 'schedule', 'now'])
                .describe(
                  'The type of the post, if we pass now, we should pass the current date also'
                ),
              postsAndComments: z
                .array(
                  z.object({
                    content: z
                      .string()
                      .describe(
                        "The content of the post, HTML, Each line must be wrapped in <p> here is the possible tags: h1, h2, h3, u, strong, li, ul, p (you can't have u and strong together). Use \"(post:<postId>)\" to embed another post's live URL - see the tool description."
                      ),
                    attachments: z
                      .array(attachmentUrl)
                      .describe(
                        'The images/videos of the post (URLs or media-library paths). An external URL is automatically copied into the media library before saving, so the post stores a durable path instead of a link that can expire.'
                      ),
                    linkToPostIds: z
                      .array(z.string())
                      .optional()
                      .describe(
                        "Ids of other posts whose live URL should appear in this post - this is how you echo a post to another channel. Any id listed here that is not already written as \"(post:<id>)\" in the content is appended to it. The URL is filled in when THIS post publishes, so it works even though the other post has not published yet and its releaseURL is still null. Get the ids from postsList (\"linkReference\") or from this tool's own output. The referenced post must be scheduled earlier than this one; if it has not published by the time this one is due, this post waits for it and then fails rather than publishing a broken link."
                      ),
                  })
                )
                .describe(
                  'first item is the post, every other item is the comments'
                ),
              settings: z
                .array(
                  z.object({
                    key: z
                      .string()
                      .describe('Name of the settings key to pass'),
                    value: z
                      .any()
                      .describe(
                        'Value of the key, always prefer the id then label if possible. When the settings schema says a field is an id, pass the id returned by the channel tools, never the display label'
                      ),
                  })
                )
                .describe(
                  'This relies on the integrationSchema tool to get the settings [input:settings]'
                ),
            })
          )
          .describe('Individual post'),
      }),
      outputSchema: z.object({
        output: z
          .array(
            z.object({
              postId: z.string(),
              integration: z.string(),
              previewUrl: z
                .string()
                .describe(
                  'Public preview page of the created post, share it with the user'
                ),
            })
          )
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;
        const finalOutput = [];

        const integrations = {} as Record<string, Integration>;
        for (const platform of inputData.socialPost) {
          integrations[platform.integrationId] =
            await this._integrationService.getIntegrationById(
              organizationId,
              platform.integrationId
            );

          // Same server-side validation as the dashboard / public API
          // (settings DTO + media checkValidity + empty / too-long content).
          const settings = platform.settings.reduce(
            (acc: AllProvidersSettings, s: { key: string; value: any }) => ({
              ...acc,
              [s.key]: s.value,
            }),
            {} as AllProvidersSettings
          );

          const [validation] = await this._postsService.validatePosts(
            organizationId,
            [
              {
                integration: { id: platform.integrationId },
                settings,
                value: platform.postsAndComments.map((p: any) => ({
                  content: withPostLinks(p),
                  image: (p.attachments || []).map((path: string) => ({
                    path,
                  })),
                })),
              },
            ]
          );

          // outputSchema wraps everything in `output`, so a bare { errors }
          // here fails tool-output validation and the agent is shown a schema
          // error instead of the reason its post was rejected.
          const rejected = (errors: string) => ({ output: { errors } });

          if (validation.emptyContent) {
            return rejected(
              `${validation.name}: Your post should have at least one character or one image.`
            );
          }

          if (platform.type !== 'draft') {
            if (!validation.valid) {
              return rejected(
                `${validation.name}: ${
                  validation.settingsError || 'Please fix your settings'
                }, please fix it, and try integrationSchedulePostTool again.`
              );
            }

            if (validation.errors !== true) {
              return rejected(
                `${validation.name}: ${validation.errors}, please fix it, and try integrationSchedulePostTool again.`
              );
            }

            if (validation.tooLong) {
              return rejected(
                `${validation.name}: The maximum characters is ${validation.maximumCharacters}, please fix it, and try integrationSchedulePostTool again.`
              );
            }
          }
        }

        // Copy-on-attach: re-host every attachment that is not already on our
        // own storage, so a temporary external URL can never be saved onto a
        // post. Done after validation (a rejected call uploads nothing) and
        // before any createPost (a failed copy leaves every post unwritten).
        // Deduped across the whole call, so a URL shared by several posts is
        // fetched once.
        let rehost: (path: string) => string;
        try {
          const hosted = await hostExternalAttachments({
            mediaService: this._mediaService,
            organizationId,
            paths: inputData.socialPost.flatMap((platform) =>
              platform.postsAndComments.flatMap(
                (item) => item.attachments || []
              )
            ),
          });
          rehost = (path: string) => hosted.get(path) ?? path;
        } catch (err) {
          return {
            output: {
              errors:
                err instanceof Error
                  ? err.message
                  : 'Failed to copy an external attachment into the media library.',
            },
          };
        }

        for (const post of inputData.socialPost) {
          const integration = integrations[post.integrationId];

          if (!integration) {
            throw new Error('Integration not found');
          }

          const output = await this._postsService.createPost(organizationId, {
            date: post.date,
            type: post.type as 'draft' | 'schedule' | 'now',
            shortLink: post.shortLink,
            tags: [],
            posts: [
              {
                integration,
                group: makeId(10),
                settings: post.settings.reduce(
                  (acc: AllProvidersSettings, s: { key: string; value: any }) => ({
                    ...acc,
                    [s.key]: s.value,
                  }),
                  {
                    __type: integration.providerIdentifier,
                  } as AllProvidersSettings
                ),
                value: post.postsAndComments.map((p: any) => ({
                  content: withPostLinks(p),
                  id: makeId(10),
                  delay: 0,
                  image: p.attachments.map((path: any) => ({
                    id: makeId(10),
                    path: rehost(path),
                  })),
                })),
              },
            ],
          }, 'MCP');
          // Same public preview page the calendar "Preview Post" button opens.
          finalOutput.push(
            ...output.map((p) => ({
              ...p,
              previewUrl: `${process.env.FRONTEND_URL}/p/${p.postId}?share=true`,
            }))
          );
        }

        return {
          output: finalOutput,
        };
      },
    });
  }
}
