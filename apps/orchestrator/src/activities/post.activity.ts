import { Injectable, Logger } from '@nestjs/common';
import { providerNeedsPaidPlan } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import {
  BadBody,
  Disconnect,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { stripLinks } from '@gitroom/helpers/utils/strip.links';
import {
  InsufficientCreditsError,
  notEnoughCreditsMessage,
  postOccurrenceChargeKey,
  repeatRunOf,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  REFUND_REASONS,
  WalletPostsService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.posts.service';
import { Context } from '@temporalio/activity';
import { WalletBillingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import { walletAlert } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.alert';
import { withWalletPublish } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.x';
import {
  Activity,
  ActivityMethod,
  TemporalService,
} from 'nestjs-temporal-core';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AuthTokenDetails,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import {
  setHeartbeatDetails,
  withHeartbeat,
} from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';

// Drops fields the workflow and downstream activities never read — biggest wins are `error` (grows per retry) and `childrenPost` (Prisma side-loads it on every recursive row).
function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    submittedForOrderId,
    submittedForOrganizationId,
    submittedForOrder,
    submittedForOrganization,
    lastMessageId,
    parentPostId,
    approvedSubmitForOrder,
    deletedAt,
    createdAt,
    updatedAt,
    payoutProblems,
    comments,
    errors,
    ...rest
  } = post;
  return rest;
}

// The text a provider sends for a message: X strips links when
// STRIP_LINKS_FROM_X_POSTS is set, and is then billed for the stripped text.
const sentTextFor =
  (provider: { stripLinks?: () => boolean }) => (message: string) =>
    provider.stripLinks?.() ? stripLinks(message) : message;

const currentRun = () => {
  try {
    return repeatRunOf(Context.current().info.workflowExecution.workflowId);
  } catch (err) {
    return undefined;
  }
};

// A genuinely missed occurrence (dead workflow) is only recovered by the
// missing-posts sweep, which runs every hour - so anything later than the
// sweep period plus retry margin is a stale anchor, not a missed publish.
const REANCHOR_GRACE_MS = 2 * 60 * 60 * 1000;

// A repeat post keeps its original anchor publishDate forever (updatePost only
// flips the state, the calendar expands occurrences virtually). If the workflow
// gets that raw past date, any (re)start - an accidental edit resetting the
// state to QUEUE, or a missing-posts sweep poke - sleeps 0 and publishes
// instantly, machine-gunning the channel. Roll the returned date forward to the
// next occurrence on the anchor grid instead, so fresh starts wait for the next
// real occurrence. Only for the initial QUEUE run: repeat chain children
// (postNow) run against a PUBLISHED post and must keep publishing immediately.
// Occurrences missed within the grace window still catch up and post.
function reanchorInterval(post: any) {
  if (!post?.intervalInDays || post.state !== State.QUEUE) {
    return post;
  }

  const interval = post.intervalInDays * 24 * 60 * 60 * 1000;
  const late = Date.now() - new Date(post.publishDate).getTime();
  if (late <= REANCHOR_GRACE_MS) {
    return post;
  }

  const next =
    new Date(post.publishDate).getTime() +
    Math.ceil(late / interval) * interval;

  return { ...post, publishDate: new Date(next) };
}

@Injectable()
@Activity()
export class PostActivity {
  private _logger = new Logger(PostActivity.name);

  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _temporalService: TemporalService,
    private _walletService: WalletService,
    private _walletBilling: WalletBillingService,
    private _walletPosts: WalletPostsService
  ) {}

  // A channel the free plan locks is open to a paid plan, or to a
  // pay-as-you-go workspace that pays per post from its wallet. Throws when
  // neither applies, and returns whether this workspace pays from its wallet.
  private async paysFromWallet(integration: Integration) {
    if (!providerNeedsPaidPlan(integration.providerIdentifier)) {
      return false;
    }
    if (
      await this._postService.organizationHasPaidPlan(
        integration.organizationId
      )
    ) {
      return false;
    }
    if (
      await this._walletService.unlocksProvider(
        integration.organizationId,
        integration.providerIdentifier
      )
    ) {
      return true;
    }
    throw new BadBody(
      integration.providerIdentifier,
      '',
      '',
      await this._walletService.lockedProviderMessageFor(
        integration.organizationId,
        integration.providerIdentifier
      )
    );
  }

  // The credits for one post as it is published. A post is paid when it is
  // scheduled, so this normally finds that charge and takes nothing more; a
  // post queued before that (or a repeat occurrence) is charged now, priced
  // on the text sent to the network. Returns the charge to give back if
  // publishing then fails.
  private async chargeForPost(
    integration: Integration,
    post: { id: string; message: string },
    sentText: string
  ) {
    try {
      // The one link rule, on the exact text sent to the network, so the
      // cost shown and the cost charged cannot drift apart.
      const actionKey = await this._walletService.postActionKey(
        integration.providerIdentifier,
        sentText,
        { sent: true }
      );
      const entry = await this._walletBilling.charge({
        organizationId: integration.organizationId,
        actionKey,
        chargeKey: postOccurrenceChargeKey(post.id, currentRun()),
        reference: post.id,
      });
      return entry.idempotencyKey!;
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        // Not posted and never retried (BadBody is not retryable).
        throw new BadBody(
          integration.providerIdentifier,
          '',
          '',
          notEnoughCreditsMessage()
        );
      }
      throw err;
    }
  }

  // Gives back the credits taken for a post the network did not publish.
  private async refundPost(
    integration: Integration,
    postId: string,
    charge: string
  ) {
    try {
      await this._walletService.refund(
        charge,
        'Refund: the post was not published'
      );
    } catch (refundErr) {
      // The post failed but its credits were not given back.
      await walletAlert(
        `Refund failed for post ${postId} (charge ${charge}, organization ${integration.organizationId})`
      ).catch(() => undefined);
      this._logger.error(
        `[wallet] REFUND FAILED for post ${postId} (charge ${charge}, organization ${integration.organizationId}): ${
          refundErr instanceof Error ? refundErr.stack : refundErr
        }`
      );
    }
  }

  // Publishes, charging each post first. Only the posts the network did not
  // publish are refunded: on success, those missing from the result; on
  // failure, all of them except any the error lists as already published
  // (`postedIds`, for a provider that sends several posts in one call and
  // fails part way). `sentText` gives the text the provider will actually send
  // for a message (e.g. with links stripped), which is what the network bills.
  // `publish` is told whether the wallet pays for this publish, so it can
  // hand the provider an integration marked for it (withWalletPublish).
  private async publishPaid<T extends PostResponse[]>(
    integration: Integration,
    posts: { id: string; message: string }[],
    sentText: (message: string) => string,
    publish: (walletPays: boolean) => Promise<T>
  ) {
    if (!(await this.paysFromWallet(integration))) {
      // Paid when it was scheduled, but this workspace no longer pays from
      // its wallet (e.g. it moved to a paid plan): give that back.
      if (
        providerNeedsPaidPlan(integration.providerIdentifier) &&
        !currentRun()
      ) {
        await this._walletPosts
          .refundPosts(
            integration.organizationId,
            posts.map((p) => p.id),
            REFUND_REASONS.includedInPlan
          )
          .catch(() => undefined);
      }
      return publish(false);
    }
    const charges: { postId: string; charge: string }[] = [];
    let published: T;
    try {
      for (const post of posts) {
        charges.push({
          postId: post.id,
          charge: await this.chargeForPost(
            integration,
            post,
            sentText(post.message)
          ),
        });
      }
      published = await publish(true);
    } catch (err) {
      const postedIds = new Set<string>(
        Array.isArray((err as { postedIds?: unknown })?.postedIds)
          ? (err as { postedIds: string[] }).postedIds
          : []
      );
      for (const { postId, charge } of charges) {
        if (!postedIds.has(postId)) {
          await this.refundPost(integration, postId, charge);
        }
      }
      throw err;
    }
    const returned = new Set((published || []).map((p) => p.id));
    for (const { postId, charge } of charges) {
      if (!returned.has(postId)) {
        await this.refundPost(integration, postId, charge);
      }
    }
    return published;
  }

  @ActivityMethod()
  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  @ActivityMethod()
  async searchForMissingThreeHoursPosts() {
    const list = await this._postService.searchForMissingThreeHoursPosts();
    for (const post of list) {
      await this._temporalService.client
        .getRawClient()
        .workflow.signalWithStart('postWorkflowV113', {
          workflowId: `post_${post.id}`,
          taskQueue: 'main',
          signal: 'poke',
          workflowIdConflictPolicy: 'USE_EXISTING',
          signalArgs: [],
          args: [
            {
              taskQueue: post.integration.providerIdentifier
                .split('-')[0]
                .toLowerCase(),
              postId: post.id,
              organizationId: post.organizationId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: post.id,
            },
            {
              key: organizationId,
              value: post.organizationId,
            },
          ]),
        });
    }
  }

  @ActivityMethod()
  async updatePost(id: string, postId: string, releaseURL: string) {
    await this._postService.updatePost(id, postId, releaseURL);
  }

  @ActivityMethod()
  async getPost(orgId: string, postId: string) {
    const post = await this._postService.getPostById(postId, orgId);
    if (post.deletedAt) {
      return false;
    }

    return reanchorInterval(post);
  }

  @ActivityMethod()
  async getPostsList(orgId: string, postId: string) {
    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    // only the root drives the pre-publish sleep and the repeat schedule,
    // the rest are comments
    const [root, ...comments] = getPosts.map(slimPost);
    return [reanchorInterval(root), ...comments];
  }

  /**
   * Whether every `(post:<id>)` reference in this post's group can be resolved
   * yet. The workflow holds the post back while this says `pending`.
   */
  @ActivityMethod()
  async postDependencies(orgId: string, postId: string) {
    const posts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );

    return this._postService.getPostDependencies(orgId, posts as any);
  }

  @ActivityMethod()
  async isCommentable(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return !!getIntegration.comment;
  }

  @ActivityMethod()
  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    // kept only for in-flight postWorkflowV108 runs, which set a
    // heartbeatTimeout on this activity - removing the sender would kill
    // them. Under V109+ (no heartbeatTimeout) this is a no-op and can be
    // dropped once all V108 executions have drained
    return withHeartbeat(() =>
      this.handleDisconnect(integration, async () => {
        const getIntegration = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        const newPosts = await this._postService.updateTags(
          integration.organizationId,
          posts
        );

        const prepared = await Promise.all(
          (newPosts || []).map(async (p) => ({
            id: p.id,
            message: stripHtmlValidation(
              getIntegration.editor,
              p.content,
              true,
              false,
              !/<\/?[a-z][\s\S]*>/i.test(p.content),
              getIntegration.mentionFormat
            ),
            settings: JSON.parse(p.settings || '{}'),
            media: await this._postService.updateMedia(
              p.id,
              JSON.parse(p.image || '[]'),
              getIntegration?.convertToJPEG || false
            ),
          }))
        );

        return this.publishPaid(
          integration,
          prepared,
          sentTextFor(getIntegration),
          (walletPays) =>
            getIntegration.comment(
              integration.internalId,
              postId,
              lastPostId,
              integration.token,
              prepared,
              withWalletPublish(integration, walletPays)
            )
        );
      })
    );
  }

  @ActivityMethod()
  async postSocial(integration: Integration, posts: Post[]) {
    return this.postSocialInternal(integration, posts, false);
  }

  // Used by postWorkflowV107 and up: providers that implement `postPending`
  // return a `pending` response the workflow resolves via checkPostStatus /
  // finalizePost. Older workflow versions keep calling `postSocial` and get
  // the old blocking behavior.
  @ActivityMethod()
  async postSocialPending(integration: Integration, posts: Post[]) {
    return this.postSocialInternal(integration, posts, true);
  }

  // A Disconnect error means the platform will keep rejecting this channel no
  // matter how many token refreshes (e.g. TikTok's daily active user cap):
  // mark the channel as needing a re-connect and notify the user, then rethrow
  // as BadBody so every workflow version - frozen once on main - treats it as
  // a terminal error without needing a new workflow.
  private async handleDisconnect<T>(
    integration: Integration,
    func: () => Promise<T>
  ): Promise<T> {
    try {
      return await func();
    } catch (err) {
      if (err instanceof Disconnect) {
        try {
          await this._integrationService.disconnectChannel(
            integration.organizationId,
            integration,
            err.message
          );
        } catch (e) {
          /**empty**/
        }

        throw new BadBody(
          integration.providerIdentifier,
          JSON.stringify({}),
          Buffer.from('{}'),
          err.message
        );
      }

      throw err;
    }
  }

  private async postSocialInternal(
    integration: Integration,
    posts: Post[],
    allowPending: boolean
  ) {
    // kept only for in-flight postWorkflowV108 runs, which set a
    // heartbeatTimeout on this activity - removing the sender would kill
    // them. Under V109+ (no heartbeatTimeout) this is a no-op and can be
    // dropped once all V108 executions have drained
    return withHeartbeat(() =>
      this.handleDisconnect(integration, () =>
        this.postSocialBody(integration, posts, allowPending)
      )
    );
  }

  private async postSocialBody(
    integration: Integration,
    posts: Post[],
    allowPending: boolean
  ) {
    // Stage markers: whatever ran last is what a timed-out activity reports.
    // Providers that go through this.fetch overwrite these with the exact URL;
    // the ones on their own HTTP client (x, youtube, bluesky) are still
    // narrowed down to the step they hung on.
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    // X is unavailable on the free plan, including posts queued
    // before that changed, unless the wallet pays for them (checked again in
    // publishPaid, where the credits are taken).
    setHeartbeatDetails('plan and wallet check');
    await this.paysFromWallet(integration);

    setHeartbeatDetails('update tags');
    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    setHeartbeatDetails('resolve media');
    const mappedPosts = await Promise.all(
      (newPosts || []).map(async (p) => ({
        id: p.id,
        message: stripHtmlValidation(
          getIntegration.editor,
          p.content,
          true,
          false,
          !/<\/?[a-z][\s\S]*>/i.test(p.content),
          getIntegration.mentionFormat,
          !!getIntegration.inlineImages?.(JSON.parse(p.settings || '{}')),
          getIntegration.htmlTags?.(JSON.parse(p.settings || '{}')) || []
        ),
        settings: JSON.parse(p.settings || '{}'),
        media: await this._postService.updateMedia(
          p.id,
          JSON.parse(p.image || '[]'),
          getIntegration?.convertToJPEG || false
        ),
      }))
    );

    // A publish the wallet pays for always takes the blocking path, so the
    // credits are settled against the network's final answer: the pending
    // path only creates the post later, in finalizePost.
    setHeartbeatDetails(`${integration.providerIdentifier}: publish`);
    const postNow = await this.publishPaid(
      integration,
      mappedPosts,
      sentTextFor(getIntegration),
      (walletPays) =>
        allowPending && getIntegration.postPending && !walletPays
          ? getIntegration.postPending(
              integration.internalId,
              integration.token,
              mappedPosts,
              integration
            )
          : getIntegration.post(
              integration.internalId,
              integration.token,
              mappedPosts,
              withWalletPublish(integration, walletPays)
            )
    );

    // The post is already published at this point: the streak is best-effort,
    // failing the activity here would retry it and publish again.
    setHeartbeatDetails(`${integration.providerIdentifier}: published, streak`);
    try {
      await this._temporalService.client
        .getRawClient()
        .workflow.start('streakWorkflowV2', {
          args: [{ organizationId: integration.organizationId }],
          workflowId: `streak_${integration.organizationId}`,
          taskQueue: 'main',
          // Keep a running streak, it checks for newer posts before it ends
          workflowIdConflictPolicy: 'USE_EXISTING',
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: organizationId,
              value: integration.organizationId,
            },
          ]),
        });
    } catch (err) {
      /**empty**/
    }

    return postNow;
  }

  @ActivityMethod()
  async checkPostStatus(integration: Integration, pendingData: any) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return this.handleDisconnect(integration, () =>
      getIntegration.checkPostStatus(integration.token, pendingData, integration)
    );
  }

  @ActivityMethod()
  async finalizePost(integration: Integration, pendingData: any) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return withHeartbeat(() =>
      this.handleDisconnect(integration, () =>
        getIntegration.finalizePost(integration.token, pendingData, integration)
      )
    );
  }

  @ActivityMethod()
  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type
    );
  }

  @ActivityMethod()
  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  @ActivityMethod()
  async changeState(id: string, state: State, err?: any, body?: any) {
    await this._postService.changeState(id, state, err, body);
  }

  @ActivityMethod()
  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  @ActivityMethod()
  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    // Webhooks are best-effort and run after the post already published, so a
    // failure here must not fail the workflow.
    try {
      const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
        (f) => {
          return (
            f.integrations.length === 0 ||
            f.integrations.some((i) => i.integration.id === integrationId)
          );
        }
      );

      if (webhooks.length === 0) {
        return;
      }

      const post = await this._postService.getPostByForWebhookId(
        postId,
        orgId,
        integrationId
      );
      await Promise.all(
        webhooks.map(async (webhook) => {
          try {
            // Re-checks the stored URL at send time and connects through the
            // SSRF-safe dispatcher; 15 s timeout, at most 3 redirects. http is
            // still accepted for webhooks saved before https was required.
            const res = await safeFetch(
              webhook.url,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(post),
              },
              { allowHttp: true }
            );
            await res.body?.cancel().catch(() => undefined);
          } catch (e) {
            /**empty**/
          }
        })
      );
    } catch (err) {
      /**empty**/
    }
  }
  @ActivityMethod()
  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  @ActivityMethod()
  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    await this._integrationService.processInternalPlug(data);
  }

  @ActivityMethod()
  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(
        integration,
        (err as Error)?.message || ''
      );
      return false;
    }
  }

  @ActivityMethod()
  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(
        integration,
        cause || (err as Error)?.message || ''
      );
      return false;
    }
  }
}
