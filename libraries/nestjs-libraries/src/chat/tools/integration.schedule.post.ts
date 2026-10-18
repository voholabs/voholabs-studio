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
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  addPendingWalletPost,
  orgFromContext,
  PendingWalletPosts,
  toCredits,
  walletPostCost,
  walletRefusal,
  walletRefusalLock,
  walletWarning,
} from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

@Injectable()
export class IntegrationSchedulePostTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _walletService: WalletService
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
Creates a draft, scheduled, or immediate social media post on the user's connected channels, based on the integrationSchema tool.
Examples of the input shape:

A single LinkedIn post with one comment
- socialPost array length will be one
- postsAndComments array length will be two (one for the post, one for the comment)

20 Facebook posts each on individual days without comments
- socialPost array length will be 20
- postsAndComments array length will be one

A call that returns errors can be run again with corrected parameters.

LINKING TO ANOTHER POST (echoing a post to other channels):
"(post:<postId>)" in the content puts the live URL of another post inside this
one. It is replaced with that post's real URL at the moment this post publishes,
so "here is my new X post: <link>" can be scheduled before the X post exists.
- The postId comes from postsList, or from the output of a previous call to this tool.
- Only a post scheduled EARLIER than this one can be referenced.
- Echoing a post that is being created now takes two calls: one for the original
  post, then one for the echo with the postId the earlier call returned.
- If the referenced post has not published by the time this one is due, this post
  waits for it, and fails instead of publishing a broken link. So an echo goes out
  with its link or not at all.
- The reference expands to a full URL, which counts toward character limits.

WALLET CREDITS (pay-as-you-go workspaces):
Some channels are paid per post from the workspace's wallet credits (walletPrices lists them; every other channel is free).
- A post on such a channel is paid when it is scheduled ("schedule" or "now"), each part of a thread separately. "cost" in the output is what was taken.
- A draft costs nothing until it is put on the schedule; "costWhenScheduled" says what that will take.
- When the credits (with auto top-up) fall short of a post, nothing is scheduled for it and the error carries the top-up link. A retry gives the same result until the credits are topped up.
- A channel that is included with Plus (X) is refused the same way without Plus, and the error carries the Plus link.

Existing posts are changed by other tools: editPostTool changes one in place, postSettingsTool changes only its channel settings, deletePostTool removes it.
On success, each item in output contains a previewUrl the user can open to see the post.
If validation fails, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
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
                .optional()
                .describe(
                  'Only matters for X: whether the account is X Premium. Defaults to false and has no effect on other platforms.'
                ),
              date: z.string().describe('The date of the post in UTC time'),
              shortLink: z
                .boolean()
                .describe(
                  'Whether a link inside the post is shortened, as the user chose'
                ),
              type: z
                .enum(['draft', 'schedule', 'now'])
                .describe(
                  'The type of the post; with "now", the date is the current date'
                ),
              postsAndComments: z
                .array(
                  z.object({
                    content: z
                      .string()
                      .describe(
                        "The content of the post, HTML, each line wrapped in <p>. The possible tags: h1, h2, h3, u, strong, li, ul, p (u and strong cannot be combined), and img (<img src=\"...\">) only when the integration rules say pictures go inside the content. A long-form article (see the integration schema, e.g. X post_type article) also keeps ol, em, blockquote, pre/code, hr and figure/figcaption. \"(post:<postId>)\" embeds another post's live URL - see the tool description."
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
                        "Ids of other posts whose live URL appears in this post - this is how a post is echoed to another channel. Any id listed here that is not already written as \"(post:<id>)\" in the content is appended to it. The URL is filled in when THIS post publishes, so it works even though the other post has not published yet and its releaseURL is still null. The ids come from postsList (\"linkReference\") or from this tool's own output. Only a post scheduled earlier than this one can be referenced; if it has not published by the time this one is due, this post waits for it and then fails rather than publishing a broken link."
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
                        'Value of the key. Where the settings schema says a field is an id, it takes the id returned by the channel tools rather than the display label'
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
              cost: z
                .number()
                .optional()
                .describe(
                  'Credits taken from the wallet for this post and its replies, now, as it is scheduled (per occurrence for a repeating post)'
                ),
              costWhenScheduled: z
                .number()
                .optional()
                .describe(
                  'For a draft: what it will take from the wallet once it is put on the schedule. Nothing is charged for a draft.'
                ),
              walletWarning: z.string().optional(),
              previewUrl: z
                .string()
                .describe(
                  'Public preview page of the created post, share it with the user'
                )
                .optional(),
            })
          )
          .or(
            z.object({
              errors: z.string(),
              locked: z
                .boolean()
                .optional()
                .describe('The channel needs Plus and this workspace does not have it'),
              reason: z.literal('plus').optional(),
              upgradeUrl: z.string().optional().describe('The Plus page'),
            })
          ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = orgFromContext(context);
        const organizationId = organization?.id;
        const finalOutput = [];
        // Wallet posts that will publish, so the warning can be added once
        // every post is on the calendar.
        const walletPosts: { cost: number }[] = [];
        // What those posts take from the wallet, priced before any of them is
        // queued (see walletWarning).
        const pending: PendingWalletPosts = new Map();
        const costs = new Map<number, number>();

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

        // What the wallet will take when each post publishes, read from the
        // content as createPost saves it. Never blocks the schedule.
        for (const [index, post] of inputData.socialPost.entries()) {
          const integration = integrations[post.integrationId];
          if (!integration) {
            continue;
          }
          const contents = post.postsAndComments.map((p: any) =>
            withPostLinks(p)
          );
          const cost = await walletPostCost(
            this._walletService,
            organization,
            integration.providerIdentifier,
            contents
          );
          if (cost === undefined) {
            continue;
          }
          costs.set(index, cost);
          if (post.type !== 'draft') {
            addPendingWalletPost(
              pending,
              integration.providerIdentifier,
              contents,
              cost
            );
          }
        }
        const warning = await walletWarning(
          this._walletService,
          organizationId,
          pending
        );

        for (const [index, post] of inputData.socialPost.entries()) {
          const integration = integrations[post.integrationId];

          if (!integration) {
            throw new Error('Integration not found');
          }

          const body: CreatePostDto = {
            date: post.date,
            type: post.type as 'draft' | 'schedule' | 'now',
            shortLink: post.shortLink,
            tags: [],
            posts: [
              {
                integration,
                group: makeId(10),
                settings: {
                  ...post.settings.reduce(
                    (acc: AllProvidersSettings, s: { key: string; value: any }) => ({
                      ...acc,
                      [s.key]: s.value,
                    }),
                    {} as AllProvidersSettings
                  ),
                  // The channel's real platform, never one the caller supplies.
                  __type: integration.providerIdentifier,
                } as AllProvidersSettings,
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
          };
          let output;
          try {
            output = await this._postsService.createPost(
              organizationId,
              body,
              'MCP'
            );
          } catch (err) {
            // A channel Plus has not opened yet (or credits are short): the
            // agent gets the reason and the link, not a raw tool failure.
            const refusal = walletRefusal(err);
            if (!refusal) {
              throw err;
            }
            const scheduled = finalOutput.map((p: any) => p.postId);
            return {
              output: {
                errors: scheduled.length
                  ? `${refusal} Already scheduled in this call, do not schedule them again: ${scheduled.join(
                      ', '
                    )}.`
                  : refusal,
                ...walletRefusalLock(err),
              },
            };
          }

          const cost = costs.get(index);
          for (const item of output as any[]) {
            // Same public preview page the calendar "Preview Post" button opens.
            item.previewUrl = `${process.env.FRONTEND_URL}/p/${item.postId}?share=true`;
            if (cost !== undefined) {
              // "cost" is what was taken now. A draft is not charged until it
              // is scheduled, so it only says what that will take.
              if (post.type === 'draft') {
                item.costWhenScheduled = toCredits(cost);
              } else {
                item.cost = toCredits(cost);
                walletPosts.push(item);
              }
            }
          }
          finalOutput.push(...output);
        }

        if (warning) {
          for (const item of walletPosts) {
            (item as any).walletWarning = warning;
          }
        }

        return {
          output: finalOutput,
        };
      },
    });
  }
}
