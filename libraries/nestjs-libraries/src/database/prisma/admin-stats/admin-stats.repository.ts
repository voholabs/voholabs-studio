import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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

export interface GrowthResponse {
  generatedAt: string;
  funnel: GrowthFunnelRow[];
  activeUsers: GrowthActiveUsers;
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
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>
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

  async getGrowth(): Promise<GrowthResponse> {
    const now = new Date();
    const starts = windowStarts(now);
    const [funnel, activeUsers, organizations, channels] = await Promise.all([
      this.growthFunnel(starts),
      this.growthActiveUsers(now),
      this.growthOrganizations(starts),
      this.growthChannels(starts),
    ]);

    return {
      generatedAt: now.toISOString(),
      funnel,
      activeUsers,
      organizations,
      channels,
    };
  }
}
