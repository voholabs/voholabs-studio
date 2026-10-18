import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  plusIsActive,
  plusPaymentFailed,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';

export interface StatsParams {
  from: Date;
  to: Date;
  unknownOnly?: boolean;
  organizationId?: string;
  includeDeleted?: boolean;
}

export interface OrgActivityParams {
  from: Date;
  to: Date;
  organizationId: string;
  includeDeleted?: boolean;
}

// Unknown errors are stored as the serialized error payload, e.g.
// {..."message":"Unknown Error"...}. Matches `message LIKE '%"message":"Unknown Error"%'`.
const UNKNOWN_ERROR_TOKEN = '"message":"Unknown Error"';

interface PerSocial {
  provider: string;
  count: number;
}

interface PerState {
  state: string;
  count: number;
}

export interface OrgActivityResponse {
  from: string;
  to: string;
  organizationId: string;
  errors: { total: number; perSocial: PerSocial[] };
  posts: { total: number; perSocial: PerSocial[] };
  connectedInRange: { total: number; perSocial: PerSocial[] };
  channels: { total: number; perSocial: PerSocial[] };
  postsByState: PerState[];
  firstActivityAt: string | null;
  lastActivityAt: string | null;
}

export interface StatsResponse {
  from: string;
  to: string;
  errors: { total: number; perSocial: PerSocial[] };
  posts: { total: number; perSocial: PerSocial[] };
  connected: { total: number; perSocial: PerSocial[] };
  publishingAccounts: { total: number; perSocial: PerSocial[] };
  scheduledAccounts: { total: number; perSocial: PerSocial[] };
  publishingChannels: { total: number; perSocial: PerSocial[] };
  scheduledChannels: { total: number; perSocial: PerSocial[] };
  activeOrgsBySource: { total: number; perSocial: PerSocial[] };
  connectedClients: { total: number; perSocial: PerSocial[] };
}

export const GROWTH_WINDOWS = ['24h', '7d', '30d', 'all'] as const;
export type GrowthWindow = (typeof GROWTH_WINDOWS)[number];

// The people who signed up in a window, and how many of them have reached each
// step since. Steps after onboarding are read from the organizations the user
// owns (ADMIN or SUPERADMIN), so a teammate invited into a busy workspace does
// not count as having connected a channel or scheduled a post.
export interface GrowthFunnelRow {
  window: GrowthWindow;
  signups: number;
  activated: number;
  onboarded: number;
  channelConnected: number;
  mcpConnected: number;
  // Pressed play on the onboarding tutorial, and reached 90% of it.
  watchedTutorial: number;
  finishedTutorial: number;
  scheduledPost: number;
  toppedUp: number;
}

export interface GrowthCount {
  window: GrowthWindow;
  count: number;
}

// People who used the app while signed in, per UTC day. Recorded from the
// day it shipped, so `since` is the first day with data.
export interface GrowthActiveUsers {
  since: string | null;
  today: number;
  // Distinct people over the last 7 and 30 days, today included.
  weekly: number;
  monthly: number;
  days: { day: string; users: number }[];
}

// Organizations whose AI agent used the MCP, per UTC day. Recorded from the
// day it shipped, so `since` is the first day with data.
export interface GrowthActiveAgents {
  since: string | null;
  today: number;
  // Distinct organizations over the last 7 and 30 days, today included.
  weekly: number;
  monthly: number;
  // organizations is distinct workspaces; byClient counts each agent, so a
  // workspace using two agents that day is in both.
  days: {
    day: string;
    organizations: number;
    byClient: Record<string, number>;
  }[];
  // Which agents people use: workspaces per agent over the last 30 days, and
  // ever connected.
  clients: { client: string; monthly: number; allTime: number }[];
}

// The money side of the same sign-up cohorts: workspaces the person owns that
// claimed the welcome credits (or turned them down), spent credits, and ever
// had a Plus subscription (split by interval, and how many still have it).
export interface GrowthMoneyFunnelRow {
  window: GrowthWindow;
  signups: number;
  claimedCredits: number;
  skippedCredits: number;
  spentCredits: number;
  subscribed: number;
  subscribedMonthly: number;
  subscribedAnnual: number;
  subscribedNow: number;
}

// Ledger totals for entries made in a window, in credits. topUpRevenue is
// what was paid for top-ups before tax, per currency, in its smallest unit.
export interface GrowthCreditsRow {
  window: GrowthWindow;
  welcome: number;
  plan: number;
  topUp: number;
  spent: number;
  expired: number;
  topUpRevenue: { currency: string; amount: number }[];
}

// Early-bird codes made for workspaces whose early bird started in a window
// (the welcome credits claim, or the skip), and how many of them went on to
// subscribe.
export interface GrowthEarlyBirdRow {
  window: GrowthWindow;
  issued: number;
  converted: number;
}

// Net credits spent on an action (charges less their refunds) and how many
// charges, over the last 30 days and ever.
export interface GrowthAction {
  actionKey: string;
  name: string;
  monthly: { credits: number; charges: number };
  allTime: { credits: number; charges: number };
}

export interface GrowthMoney {
  funnel: GrowthMoneyFunnelRow[];
  plus: {
    active: number;
    monthly: number;
    annual: number;
    cancelling: number;
    pastDue: number;
    // Active subscriptions a discount takes all of; left out of mrr.
    comped: number;
    // Monthly recurring revenue per currency, in its smallest unit: monthly
    // prices plus a twelfth of annual ones. Read from Stripe, or from the
    // price settings when Stripe could not be read (comped is then unknown).
    mrr: { currency: string; amount: number }[];
    mrrSource: 'stripe' | 'settings';
  };
  earlyBird: GrowthEarlyBirdRow[];
  credits: GrowthCreditsRow[];
  // Pay-as-you-go workspaces from before Plus (first top-up before
  // plus_launch_at): still open (not on hold), now on Plus, and spent
  // credits in the last 30 days.
  legacy: { total: number; open: number; onPlus: number; spentLast30d: number };
  topActions: GrowthAction[];
}

// What the repository reads for GrowthMoney; the service prices the active
// subscriptions and names the actions.
export interface GrowthMoneyRows
  extends Omit<GrowthMoney, 'plus' | 'topActions'> {
  plus: Omit<GrowthMoney['plus'], 'comped' | 'mrr' | 'mrrSource'> & {
    subscriptions: { subscriptionId: string; interval: string | null }[];
  };
  topActions: Omit<GrowthAction, 'name'>[];
}

export interface GrowthResponse {
  generatedAt: string;
  funnel: GrowthFunnelRow[];
  activeUsers: GrowthActiveUsers;
  activeAgents: GrowthActiveAgents;
  organizations: {
    total: number;
    withChannel: number;
    withMcp: number;
    toppedUp: number;
    created: GrowthCount[];
  };
  channels: {
    connected: number;
    disabled: number;
    removed: number;
    created: GrowthCount[];
    perSocial: PerSocial[];
  };
  money: GrowthMoney;
}

const sortDesc = (list: PerSocial[]) =>
  list.sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));

// The columns are `timestamp` holding UTC. An ISO string cast to `timestamp`
// drops its "Z", so the comparison never depends on the session time zone.
const utc = (date: Date) => date.toISOString();

const windowStarts = (now: Date): Record<GrowthWindow, Date> => {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const day = 24 * 60 * 60 * 1000;
  return {
    '24h': ago(day),
    '7d': ago(7 * day),
    '30d': ago(30 * day),
    all: new Date(0),
  };
};

@Injectable()
export class AdminStatsRepository {
  constructor(
    private _post: PrismaRepository<'post' | '$queryRaw'>,
    private _integration: PrismaRepository<'integration'>,
    private _errors: PrismaRepository<'errors'>,
    private _oauthApp: PrismaRepository<'oAuthApp'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>,
    private _agentActivity: PrismaRepository<'agentActivityDay'>,
    private _agentConnection: PrismaRepository<'agentConnection'>,
    private _user: PrismaRepository<'user'>,
    private _wallet: PrismaRepository<'wallet'>,
    private _walletEntry: PrismaRepository<'walletEntry'>
  ) {}

  private async errorStats(params: StatsParams) {
    const where: Prisma.ErrorsWhereInput = {
      createdAt: { gte: params.from, lte: params.to },
      ...(params.unknownOnly
        ? { message: { contains: UNKNOWN_ERROR_TOKEN } }
        : {}),
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
    };

    const [total, grouped] = await Promise.all([
      this._errors.model.errors.count({ where }),
      this._errors.model.errors.groupBy({
        by: ['platform'],
        where,
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      perSocial: sortDesc(
        grouped.map((g) => ({
          provider: g.platform,
          count: g._count._all,
        }))
      ),
    };
  }

  private async postStats(params: StatsParams) {
    // Only count top-level posts (thread children share a parentPostId) so the
    // numbers match a "post published to a channel" rather than every fragment.
    const where: Prisma.PostWhereInput = {
      state: 'PUBLISHED',
      parentPostId: null,
      ...(params.includeDeleted ? {} : { deletedAt: null }),
      publishDate: { gte: params.from, lte: params.to },
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
    };

    const [total, grouped] = await Promise.all([
      this._post.model.post.count({ where }),
      this._post.model.post.groupBy({
        by: ['integrationId'],
        where,
        _count: { _all: true },
      }),
    ]);

    // groupBy can't reach into the integration relation, so resolve the
    // providerIdentifier for the integrations we saw and fold the counts.
    const integrationIds = grouped.map((g) => g.integrationId);
    const integrations = integrationIds.length
      ? await this._integration.model.integration.findMany({
          where: { id: { in: integrationIds } },
          select: { id: true, providerIdentifier: true },
        })
      : [];
    const providerById = new Map(
      integrations.map((i) => [i.id, i.providerIdentifier])
    );

    const byProvider = new Map<string, number>();
    for (const g of grouped) {
      const provider = providerById.get(g.integrationId) || 'unknown';
      byProvider.set(provider, (byProvider.get(provider) || 0) + g._count._all);
    }

    return {
      total,
      perSocial: sortDesc(
        [...byProvider.entries()].map(([provider, count]) => ({
          provider,
          count,
        }))
      ),
    };
  }

  // Distinct organizations with at least one top-level post in the range,
  // per provider and overall: "publishing" = already PUBLISHED, "scheduled" =
  // QUEUE or PUBLISHED (a published post was scheduled for that day too).
  // The totals are distinct across all providers combined, not a summation.
  private async accountStats(params: StatsParams) {
    const whereBase: Prisma.PostWhereInput = {
      parentPostId: null,
      deletedAt: null,
      publishDate: { gte: params.from, lte: params.to },
    };

    const [publishedGroups, scheduledGroups] = await Promise.all([
      this._post.model.post.groupBy({
        by: ['organizationId', 'integrationId'],
        where: { ...whereBase, state: 'PUBLISHED' },
      }),
      this._post.model.post.groupBy({
        by: ['organizationId', 'integrationId'],
        where: { ...whereBase, state: { in: ['QUEUE', 'PUBLISHED'] } },
      }),
    ]);

    const integrationIds = [
      ...new Set(
        [...publishedGroups, ...scheduledGroups].map((g) => g.integrationId)
      ),
    ];
    const integrations = integrationIds.length
      ? await this._integration.model.integration.findMany({
          where: { id: { in: integrationIds } },
          select: { id: true, providerIdentifier: true },
        })
      : [];
    const providerById = new Map(
      integrations.map((i) => [i.id, i.providerIdentifier])
    );

    const distinctOrgs = (
      groups: { organizationId: string; integrationId: string }[]
    ) => {
      const allOrgs = new Set<string>();
      const orgsByProvider = new Map<string, Set<string>>();
      for (const g of groups) {
        const provider = providerById.get(g.integrationId) || 'unknown';
        if (!orgsByProvider.has(provider)) {
          orgsByProvider.set(provider, new Set());
        }
        orgsByProvider.get(provider)!.add(g.organizationId);
        allOrgs.add(g.organizationId);
      }
      return {
        total: allOrgs.size,
        perSocial: sortDesc(
          [...orgsByProvider.entries()].map(([provider, orgs]) => ({
            provider,
            count: orgs.size,
          }))
        ),
      };
    };

    // Same idea per channel: distinct integrations regardless of which
    // organization owns them (a user with two TikTok channels counts twice).
    const distinctChannels = (
      groups: { organizationId: string; integrationId: string }[]
    ) => {
      const allChannels = new Set<string>();
      const channelsByProvider = new Map<string, Set<string>>();
      for (const g of groups) {
        const provider = providerById.get(g.integrationId) || 'unknown';
        if (!channelsByProvider.has(provider)) {
          channelsByProvider.set(provider, new Set());
        }
        channelsByProvider.get(provider)!.add(g.integrationId);
        allChannels.add(g.integrationId);
      }
      return {
        total: allChannels.size,
        perSocial: sortDesc(
          [...channelsByProvider.entries()].map(([provider, channels]) => ({
            provider,
            count: channels.size,
          }))
        ),
      };
    };

    return {
      publishingAccounts: distinctOrgs(publishedGroups),
      scheduledAccounts: distinctOrgs(scheduledGroups),
      publishingChannels: distinctChannels(publishedGroups),
      scheduledChannels: distinctChannels(scheduledGroups),
    };
  }

  // Distinct organizations with at least one top-level scheduled, published
  // or failed post in the range, per creation source (web, API, MCP, ...).
  // The total is distinct across all sources combined, not a summation.
  private async sourceStats(params: StatsParams) {
    const where: Prisma.PostWhereInput = {
      parentPostId: null,
      deletedAt: null,
      publishDate: { gte: params.from, lte: params.to },
      state: { in: ['QUEUE', 'PUBLISHED', 'ERROR'] },
    };

    const groups = await this._post.model.post.groupBy({
      by: ['organizationId', 'creationMethod'],
      where,
    });

    const allOrgs = new Set<string>();
    const orgsBySource = new Map<string, Set<string>>();
    for (const g of groups) {
      if (!orgsBySource.has(g.creationMethod)) {
        orgsBySource.set(g.creationMethod, new Set());
      }
      orgsBySource.get(g.creationMethod)!.add(g.organizationId);
      allOrgs.add(g.organizationId);
    }

    return {
      total: allOrgs.size,
      perSocial: sortDesc(
        [...orgsBySource.entries()].map(([provider, orgs]) => ({
          provider,
          count: orgs.size,
        }))
      ),
    };
  }

  private async connectedStats(params: StatsParams) {
    const where: Prisma.IntegrationWhereInput = {
      ...(params.includeDeleted ? {} : { deletedAt: null }),
      createdAt: { gte: params.from, lte: params.to },
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
    };

    const [total, grouped] = await Promise.all([
      this._integration.model.integration.count({ where }),
      this._integration.model.integration.groupBy({
        by: ['providerIdentifier'],
        where,
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      perSocial: sortDesc(
        grouped.map((g) => ({
          provider: g.providerIdentifier,
          count: g._count._all,
        }))
      ),
    };
  }

  // Active OAuth authorizations first created in the range (MCP clients like
  // Claude, Cursor or ChatGPT connecting to Postiz), per client name. A
  // re-authorization upserts the same row, so it keeps its original createdAt
  // and is not counted again. Dynamic registration creates a new OAuthApp row
  // for every client install, so the counts are folded by the registered
  // client_name rather than by app id.
  private async clientStats(params: StatsParams) {
    const where: Prisma.OAuthAuthorizationWhereInput = {
      accessToken: { not: null },
      ...(params.includeDeleted ? {} : { revokedAt: null }),
      createdAt: { gte: params.from, lte: params.to },
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
    };

    const [total, grouped] = await Promise.all([
      this._oauthAuth.model.oAuthAuthorization.count({ where }),
      this._oauthAuth.model.oAuthAuthorization.groupBy({
        by: ['oauthAppId'],
        where,
        _count: { _all: true },
      }),
    ]);

    // groupBy can't reach into the oauthApp relation, so resolve the client
    // name for the apps we saw and fold the counts.
    const appIds = grouped.map((g) => g.oauthAppId);
    const apps = appIds.length
      ? await this._oauthApp.model.oAuthApp.findMany({
          where: { id: { in: appIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(
      apps.map((a) => [a.id, a.name.trim().toLowerCase()])
    );

    const byName = new Map<string, number>();
    for (const g of grouped) {
      const name = nameById.get(g.oauthAppId) || 'unknown';
      byName.set(name, (byName.get(name) || 0) + g._count._all);
    }

    return {
      total,
      perSocial: sortDesc(
        [...byName.entries()].map(([provider, count]) => ({
          provider,
          count,
        }))
      ),
    };
  }

  private async postStateStats(params: OrgActivityParams) {
    const grouped = await this._post.model.post.groupBy({
      by: ['state'],
      where: {
        organizationId: params.organizationId,
        parentPostId: null,
        ...(params.includeDeleted ? {} : { deletedAt: null }),
        publishDate: { gte: params.from, lte: params.to },
      },
      _count: { _all: true },
    });

    return grouped
      .map((g) => ({ state: g.state as string, count: g._count._all }))
      .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
  }

  private async currentChannelStats(
    organizationId: string,
    includeDeleted?: boolean
  ) {
    const where: Prisma.IntegrationWhereInput = {
      organizationId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    };

    const [total, grouped] = await Promise.all([
      this._integration.model.integration.count({ where }),
      this._integration.model.integration.groupBy({
        by: ['providerIdentifier'],
        where,
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      perSocial: sortDesc(
        grouped.map((g) => ({
          provider: g.providerIdentifier,
          count: g._count._all,
        }))
      ),
    };
  }

  private async activityRange(
    organizationId: string,
    includeDeleted?: boolean
  ) {
    const { _min, _max } = await this._post.model.post.aggregate({
      where: {
        organizationId,
        state: 'PUBLISHED',
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      _min: { publishDate: true },
      _max: { publishDate: true },
    });

    return {
      firstActivityAt: _min.publishDate?.toISOString() || null,
      lastActivityAt: _max.publishDate?.toISOString() || null,
    };
  }

  async getOrgActivity(
    params: OrgActivityParams
  ): Promise<OrgActivityResponse> {
    const [errors, posts, connectedInRange, channels, postsByState, activity] =
      await Promise.all([
        this.errorStats(params),
        this.postStats(params),
        this.connectedStats(params),
        this.currentChannelStats(params.organizationId, params.includeDeleted),
        this.postStateStats(params),
        this.activityRange(params.organizationId, params.includeDeleted),
      ]);

    return {
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      organizationId: params.organizationId,
      errors,
      posts,
      connectedInRange,
      channels,
      postsByState,
      ...activity,
    };
  }

  async getStats(params: StatsParams): Promise<StatsResponse> {
    const [
      errors,
      posts,
      accounts,
      connected,
      activeOrgsBySource,
      connectedClients,
    ] = await Promise.all([
      this.errorStats(params),
      this.postStats(params),
      this.accountStats(params),
      this.connectedStats(params),
      this.sourceStats(params),
      this.clientStats(params),
    ]);

    return {
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      errors,
      posts,
      connected,
      publishingAccounts: accounts.publishingAccounts,
      scheduledAccounts: accounts.scheduledAccounts,
      publishingChannels: accounts.publishingChannels,
      scheduledChannels: accounts.scheduledChannels,
      activeOrgsBySource,
      connectedClients,
    };
  }

  private async growthFunnel(
    starts: Record<GrowthWindow, Date>
  ): Promise<GrowthFunnelRow[]> {
    const db = this._post.model;
    const rows = await db.$queryRaw<
      Array<{
        window: GrowthWindow;
        signups: bigint;
        activated: bigint;
        onboarded: bigint;
        channelConnected: bigint;
        mcpConnected: bigint;
        watchedTutorial: bigint;
        finishedTutorial: bigint;
        scheduledPost: bigint;
        toppedUp: bigint;
      }>
    >`
      WITH owned AS (
        SELECT uo."userId", uo."organizationId"
        FROM "UserOrganization" uo
        WHERE uo.role IN ('ADMIN', 'SUPERADMIN')
      ), steps AS (
        SELECT u."createdAt",
          u.activated,
          u."onboardedAt" IS NOT NULL AS onboarded,
          u."tutorialStartedAt" IS NOT NULL AS tutorial,
          COALESCE(u."tutorialWatchedPercent", 0) >= 90 AS "tutorialFinished",
          EXISTS (SELECT 1 FROM owned o JOIN "Integration" i ON i."organizationId" = o."organizationId"
            WHERE o."userId" = u.id) AS channel,
          EXISTS (SELECT 1 FROM owned o JOIN "Organization" org ON org.id = o."organizationId"
            WHERE o."userId" = u.id AND org."agentFirstConnectedAt" IS NOT NULL) AS mcp,
          EXISTS (SELECT 1 FROM owned o JOIN "Post" p ON p."organizationId" = o."organizationId"
            WHERE o."userId" = u.id AND p."parentPostId" IS NULL) AS scheduled,
          EXISTS (SELECT 1 FROM owned o JOIN "WalletEntry" w ON w."organizationId" = o."organizationId"
            WHERE o."userId" = u.id AND w.type IN ('TOPUP', 'AUTO_TOPUP')) AS topup
        FROM "User" u
      ), windows ("window", since) AS (
        VALUES ('24h', ${utc(starts['24h'])}::timestamp),
          ('7d', ${utc(starts['7d'])}::timestamp),
          ('30d', ${utc(starts['30d'])}::timestamp),
          ('all', ${utc(starts.all)}::timestamp)
      )
      SELECT w."window",
        COUNT(s."createdAt") AS signups,
        COUNT(*) FILTER (WHERE s.activated) AS activated,
        COUNT(*) FILTER (WHERE s.onboarded) AS onboarded,
        COUNT(*) FILTER (WHERE s.channel) AS "channelConnected",
        COUNT(*) FILTER (WHERE s.mcp) AS "mcpConnected",
        COUNT(*) FILTER (WHERE s.tutorial) AS "watchedTutorial",
        COUNT(*) FILTER (WHERE s."tutorialFinished") AS "finishedTutorial",
        COUNT(*) FILTER (WHERE s.scheduled) AS "scheduledPost",
        COUNT(*) FILTER (WHERE s.topup) AS "toppedUp"
      FROM windows w
      LEFT JOIN steps s ON s."createdAt" >= w.since
      GROUP BY w."window"`;

    return GROWTH_WINDOWS.map((window) => {
      const r = rows.find((row) => row.window === window);
      return {
        window,
        signups: Number(r?.signups || 0),
        activated: Number(r?.activated || 0),
        onboarded: Number(r?.onboarded || 0),
        channelConnected: Number(r?.channelConnected || 0),
        mcpConnected: Number(r?.mcpConnected || 0),
        watchedTutorial: Number(r?.watchedTutorial || 0),
        finishedTutorial: Number(r?.finishedTutorial || 0),
        scheduledPost: Number(r?.scheduledPost || 0),
        toppedUp: Number(r?.toppedUp || 0),
      };
    });
  }

  private async growthOrganizations(starts: Record<GrowthWindow, Date>) {
    const db = this._post.model;
    const [row] = await db.$queryRaw<
      Array<{
        total: bigint;
        withChannel: bigint;
        withMcp: bigint;
        toppedUp: bigint;
        d1: bigint;
        d7: bigint;
        d30: bigint;
      }>
    >`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Integration" i
          WHERE i."organizationId" = org.id AND i."deletedAt" IS NULL AND i.disabled = false)) AS "withChannel",
        COUNT(*) FILTER (WHERE org."agentFirstConnectedAt" IS NOT NULL) AS "withMcp",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "WalletEntry" w
          WHERE w."organizationId" = org.id AND w.type IN ('TOPUP', 'AUTO_TOPUP'))) AS "toppedUp",
        COUNT(*) FILTER (WHERE org."createdAt" >= ${utc(starts['24h'])}::timestamp) AS d1,
        COUNT(*) FILTER (WHERE org."createdAt" >= ${utc(starts['7d'])}::timestamp) AS d7,
        COUNT(*) FILTER (WHERE org."createdAt" >= ${utc(starts['30d'])}::timestamp) AS d30
      FROM "Organization" org`;

    const total = Number(row?.total || 0);
    return {
      total,
      withChannel: Number(row?.withChannel || 0),
      withMcp: Number(row?.withMcp || 0),
      toppedUp: Number(row?.toppedUp || 0),
      created: [
        { window: '24h' as const, count: Number(row?.d1 || 0) },
        { window: '7d' as const, count: Number(row?.d7 || 0) },
        { window: '30d' as const, count: Number(row?.d30 || 0) },
        { window: 'all' as const, count: total },
      ],
    };
  }

  private async growthChannels(starts: Record<GrowthWindow, Date>) {
    const integration = this._integration.model.integration;
    const live: Prisma.IntegrationWhereInput = {
      deletedAt: null,
      disabled: false,
    };
    const createdSince = (since: Date) =>
      integration.count({ where: { deletedAt: null, createdAt: { gte: since } } });

    const [connected, disabled, removed, d1, d7, d30, grouped] =
      await Promise.all([
        integration.count({ where: live }),
        integration.count({ where: { deletedAt: null, disabled: true } }),
        integration.count({ where: { deletedAt: { not: null } } }),
        createdSince(starts['24h']),
        createdSince(starts['7d']),
        createdSince(starts['30d']),
        integration.groupBy({
          by: ['providerIdentifier'],
          where: live,
          _count: { _all: true },
        }),
      ]);

    return {
      connected,
      disabled,
      removed,
      created: [
        { window: '24h' as const, count: d1 },
        { window: '7d' as const, count: d7 },
        { window: '30d' as const, count: d30 },
        { window: 'all' as const, count: connected + disabled },
      ],
      perSocial: sortDesc(
        grouped.map((g) => ({
          provider: g.providerIdentifier,
          count: g._count._all,
        }))
      ),
    };
  }

  private async growthActiveUsers(
    now: Date,
    days = 30
  ): Promise<GrowthActiveUsers> {
    const db = this._post.model;
    const day = (offset: number) =>
      new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const today = day(0);
    const first = day(days - 1);
    const weekStart = day(6);

    const [series, [totals]] = await Promise.all([
      db.$queryRaw<Array<{ day: string; users: bigint }>>`
        SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(a."userId") AS users
        FROM generate_series(${first}::date, ${today}::date, interval '1 day') d
        LEFT JOIN "UserActivityDay" a ON a.day = d::date
        GROUP BY d
        ORDER BY d`,
      db.$queryRaw<
        Array<{ since: string | null; weekly: bigint; monthly: bigint }>
      >`
        SELECT (SELECT to_char(MIN(day), 'YYYY-MM-DD') FROM "UserActivityDay") AS since,
          COUNT(DISTINCT "userId") FILTER (WHERE day >= ${weekStart}::date) AS weekly,
          COUNT(DISTINCT "userId") AS monthly
        FROM "UserActivityDay"
        WHERE day >= ${first}::date`,
    ]);

    const list = series.map((row) => ({
      day: row.day,
      users: Number(row.users),
    }));
    return {
      since: totals?.since || null,
      today: list.find((row) => row.day === today)?.users || 0,
      weekly: Number(totals?.weekly || 0),
      monthly: Number(totals?.monthly || 0),
      days: list,
    };
  }

  private async growthActiveAgents(
    now: Date,
    days = 30
  ): Promise<GrowthActiveAgents> {
    const db = this._agentActivity.model.agentActivityDay;
    const day = (offset: number) =>
      new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const today = day(0);
    const first = new Date(day(days - 1));
    const weekStart = new Date(day(6));

    const [rows, earliest, connections] = await Promise.all([
      db.findMany({
        where: { day: { gte: first } },
        select: { organizationId: true, client: true, day: true },
      }),
      db.findFirst({ orderBy: { day: 'asc' }, select: { day: true } }),
      this._agentConnection.model.agentConnection.groupBy({
        by: ['client', 'organizationId'],
      }),
    ]);

    // Distinct workspaces per day, and per agent per day
    const perDay = new Map<
      string,
      { organizations: Set<string>; byClient: Record<string, number> }
    >();
    const weekly = new Set<string>();
    const monthly = new Set<string>();
    const monthlyByClient = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = row.day.toISOString().slice(0, 10);
      const entry = perDay.get(key) || {
        organizations: new Set<string>(),
        byClient: {},
      };
      entry.organizations.add(row.organizationId);
      entry.byClient[row.client] = (entry.byClient[row.client] || 0) + 1;
      perDay.set(key, entry);
      monthly.add(row.organizationId);
      if (row.day >= weekStart) {
        weekly.add(row.organizationId);
      }
      const clientOrgs = monthlyByClient.get(row.client) || new Set<string>();
      clientOrgs.add(row.organizationId);
      monthlyByClient.set(row.client, clientOrgs);
    }

    const allTime = new Map<string, number>();
    for (const connection of connections) {
      allTime.set(
        connection.client,
        (allTime.get(connection.client) || 0) + 1
      );
    }

    const list = Array.from({ length: days }, (_, i) => {
      const d = day(days - 1 - i);
      const entry = perDay.get(d);
      return {
        day: d,
        organizations: entry?.organizations.size || 0,
        byClient: entry?.byClient || {},
      };
    });
    const clients = Array.from(
      new Set([...monthlyByClient.keys(), ...allTime.keys()])
    )
      .map((client) => ({
        client,
        monthly: monthlyByClient.get(client)?.size || 0,
        allTime: allTime.get(client) || 0,
      }))
      .sort(
        (a, b) =>
          b.monthly - a.monthly ||
          b.allTime - a.allTime ||
          a.client.localeCompare(b.client)
      );

    return {
      since: earliest ? earliest.day.toISOString().slice(0, 10) : null,
      today: perDay.get(today)?.organizations.size || 0,
      weekly: weekly.size,
      monthly: monthly.size,
      days: list,
      clients,
    };
  }

  // Net credits (hundredths) and charges per action since a date: charges
  // less their refunds, which carry the charge's action.
  private async growthActionTotals(since: Date) {
    const rows = await this._walletEntry.model.walletEntry.groupBy({
      by: ['actionKey', 'type'],
      where: {
        type: { in: ['SPEND', 'REFUND'] },
        actionKey: { not: null },
        createdAt: { gte: since },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const totals = new Map<string, { amount: number; charges: number }>();
    for (const row of rows) {
      const key = row.actionKey!;
      const total = totals.get(key) || { amount: 0, charges: 0 };
      total.amount -= row._sum.amount || 0;
      if (row.type === 'SPEND') {
        total.charges += row._count._all;
      }
      totals.set(key, total);
    }
    return totals;
  }

  // The money funnel and the Plus, early-bird, credits, legacy and action
  // numbers for the growth dashboard. plusLaunchAt is when Plus launched: a
  // first top-up before it is pay-as-you-go from before Plus (unset, every
  // workspace that topped up is).
  async getGrowthMoney(plusLaunchAt?: Date): Promise<GrowthMoneyRows> {
    const now = new Date();
    const starts = windowStarts(now);
    const entry = this._walletEntry.model.walletEntry;
    // A spend: a charge that took credits. Plan credits running out
    // (PLAN_EXPIRE) and clawbacks or admin debits (ADJUST) are not spends.
    const spend: Prisma.WalletEntryWhereInput = {
      type: 'SPEND',
      amount: { lt: 0 },
    };

    const [
      users,
      wallets,
      welcomeEntries,
      spenders,
      planGranted,
      recentSpenders,
      ledger,
      monthlyActions,
      allTimeActions,
    ] = await Promise.all([
      this._user.model.user.findMany({
        select: {
          createdAt: true,
          organizations: {
            where: { role: { in: ['ADMIN', 'SUPERADMIN'] } },
            select: { organizationId: true },
          },
        },
      }),
      this._wallet.model.wallet.findMany({
        select: {
          organizationId: true,
          createdAt: true,
          firstTopUpAt: true,
          frozenAt: true,
          welcomeCreditsSkippedAt: true,
          plusSubscriptionId: true,
          plusStatus: true,
          plusInterval: true,
          plusPeriodEnd: true,
          plusCancelAt: true,
          plusPaidPeriodStart: true,
          plusEarlyBirdCodeId: true,
        },
      }),
      entry.findMany({
        where: { type: 'GRANT', idempotencyKey: { startsWith: 'welcome:' } },
        select: {
          organizationId: true,
          amount: true,
          idempotencyKey: true,
          createdAt: true,
        },
      }),
      entry.groupBy({ by: ['organizationId'], where: spend }),
      entry.groupBy({ by: ['organizationId'], where: { type: 'PLAN_GRANT' } }),
      entry.groupBy({
        by: ['organizationId'],
        where: { ...spend, createdAt: { gte: starts['30d'] } },
      }),
      Promise.all(
        GROWTH_WINDOWS.map((window) =>
          entry.groupBy({
            by: ['type', 'currency'],
            where: { createdAt: { gte: starts[window] } },
            _sum: { amount: true, paidAmount: true },
          })
        )
      ),
      this.growthActionTotals(starts['30d']),
      this.growthActionTotals(starts.all),
    ]);

    type WalletRow = (typeof wallets)[number];
    const walletOf = new Map(wallets.map((w) => [w.organizationId, w]));
    // The welcome claim is the entry keyed welcome:<its own organization>.
    const welcome = welcomeEntries.filter(
      (e) => e.idempotencyKey === `welcome:${e.organizationId}`
    );
    const welcomeAt = new Map(welcome.map((e) => [e.organizationId, e.createdAt]));
    const spent = new Set(spenders.map((s) => s.organizationId));
    const planned = new Set(planGranted.map((p) => p.organizationId));
    const spentRecently = new Set(recentSpenders.map((s) => s.organizationId));

    // A Plus subscription that was ever on: its span was paid, or it
    // released plan credits. One that never got paid (incomplete) is not.
    const everPlus = (w?: WalletRow) =>
      !!w?.plusSubscriptionId &&
      (!!w.plusPaidPeriodStart || planned.has(w.organizationId));
    const plusNow = (w?: WalletRow) => plusIsActive(w, now);

    const funnel = GROWTH_WINDOWS.map((window) => {
      const cohort = users.filter((u) => u.createdAt >= starts[window]);
      const count = (test: (id: string, w?: WalletRow) => boolean) =>
        cohort.filter((u) =>
          u.organizations.some((o) =>
            test(o.organizationId, walletOf.get(o.organizationId))
          )
        ).length;
      return {
        window,
        signups: cohort.length,
        claimedCredits: count((id) => welcomeAt.has(id)),
        skippedCredits: count(
          (id, w) => !welcomeAt.has(id) && !!w?.welcomeCreditsSkippedAt
        ),
        spentCredits: count((id) => spent.has(id)),
        subscribed: count((_, w) => everPlus(w)),
        subscribedMonthly: count(
          (_, w) => everPlus(w) && w?.plusInterval === 'month'
        ),
        subscribedAnnual: count(
          (_, w) => everPlus(w) && w?.plusInterval === 'year'
        ),
        subscribedNow: count((_, w) => plusNow(w)),
      };
    });

    const active = wallets.filter(plusNow);

    // The early bird starts at the welcome credits claim, or at the skip.
    const coded = wallets
      .filter((w) => w.plusEarlyBirdCodeId)
      .map((w) => ({
        startedAt:
          welcomeAt.get(w.organizationId) ||
          w.welcomeCreditsSkippedAt ||
          w.createdAt,
        converted: everPlus(w),
      }));
    const earlyBird = GROWTH_WINDOWS.map((window) => {
      const issued = coded.filter((c) => c.startedAt >= starts[window]);
      return {
        window,
        issued: issued.length,
        converted: issued.filter((c) => c.converted).length,
      };
    });

    const credits = GROWTH_WINDOWS.map((window, i) => {
      const sum = (...types: string[]) =>
        ledger[i]
          .filter((row) => types.includes(row.type))
          .reduce((total, row) => total + (row._sum.amount || 0), 0);
      const revenue = new Map<string, number>();
      for (const row of ledger[i]) {
        if (
          (row.type === 'TOPUP' || row.type === 'AUTO_TOPUP') &&
          row.currency &&
          row._sum.paidAmount
        ) {
          const currency = row.currency.toUpperCase();
          revenue.set(
            currency,
            (revenue.get(currency) || 0) + row._sum.paidAmount
          );
        }
      }
      return {
        window,
        welcome:
          welcome
            .filter((e) => e.createdAt >= starts[window])
            .reduce((total, e) => total + e.amount, 0) / 100,
        plan: sum('PLAN_GRANT') / 100,
        topUp: sum('TOPUP', 'AUTO_TOPUP') / 100,
        spent: (0 - sum('SPEND', 'REFUND')) / 100,
        expired: (0 - sum('PLAN_EXPIRE')) / 100,
        topUpRevenue: Array.from(revenue, ([currency, amount]) => ({
          currency,
          amount,
        })),
      };
    });

    const legacy = wallets.filter(
      (w) =>
        !!w.firstTopUpAt &&
        (!plusLaunchAt || w.firstTopUpAt.getTime() < plusLaunchAt.getTime())
    );

    const topActions = Array.from(allTimeActions, ([actionKey, total]) => {
      const month = monthlyActions.get(actionKey);
      return {
        actionKey,
        monthly: {
          credits: (month?.amount || 0) / 100,
          charges: month?.charges || 0,
        },
        allTime: { credits: total.amount / 100, charges: total.charges },
      };
    })
      .sort(
        (a, b) =>
          b.monthly.credits - a.monthly.credits ||
          b.allTime.credits - a.allTime.credits ||
          a.actionKey.localeCompare(b.actionKey)
      )
      .slice(0, 10);

    return {
      funnel,
      plus: {
        active: active.length,
        monthly: active.filter((w) => w.plusInterval === 'month').length,
        annual: active.filter((w) => w.plusInterval === 'year').length,
        cancelling: active.filter((w) => w.plusCancelAt).length,
        // A renewal not paid; a first payment never completed is not one.
        pastDue: wallets.filter((w) => plusPaymentFailed(w) && everPlus(w))
          .length,
        subscriptions: active.map((w) => ({
          subscriptionId: w.plusSubscriptionId!,
          interval: w.plusInterval,
        })),
      },
      earlyBird,
      credits,
      legacy: {
        total: legacy.length,
        open: legacy.filter((w) => !plusNow(w) && !w.frozenAt).length,
        onPlus: legacy.filter(plusNow).length,
        spentLast30d: legacy.filter((w) => spentRecently.has(w.organizationId))
          .length,
      },
      topActions,
    };
  }

  async getGrowth(): Promise<Omit<GrowthResponse, 'money'>> {
    const now = new Date();
    const starts = windowStarts(now);
    const [funnel, activeUsers, activeAgents, organizations, channels] =
      await Promise.all([
        this.growthFunnel(starts),
        this.growthActiveUsers(now),
        this.growthActiveAgents(now),
        this.growthOrganizations(starts),
        this.growthChannels(starts),
      ]);

    return {
      generatedAt: now.toISOString(),
      funnel,
      activeUsers,
      activeAgents,
      organizations,
      channels,
    };
  }
}
