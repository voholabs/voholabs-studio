import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface StatsParams {
  from: Date;
  to: Date;
  unknownOnly?: boolean;
}

// Unknown errors are stored as the serialized error payload, e.g.
// {..."message":"Unknown Error"...}. Matches `message LIKE '%"message":"Unknown Error"%'`.
const UNKNOWN_ERROR_TOKEN = '"message":"Unknown Error"';

interface PerSocial {
  provider: string;
  count: number;
}

export interface StatsResponse {
  from: string;
  to: string;
  errors: { total: number; perSocial: PerSocial[] };
  posts: { total: number; perSocial: PerSocial[] };
  connected: { total: number; perSocial: PerSocial[] };
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
  scheduledPost: number;
  toppedUp: number;
}

export interface GrowthCount {
  window: GrowthWindow;
  count: number;
}

export interface GrowthResponse {
  generatedAt: string;
  funnel: GrowthFunnelRow[];
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
    private _errors: PrismaRepository<'errors'>
  ) {}

  private async errorStats(params: StatsParams) {
    const where: Prisma.ErrorsWhereInput = {
      createdAt: { gte: params.from, lte: params.to },
      ...(params.unknownOnly
        ? { message: { contains: UNKNOWN_ERROR_TOKEN } }
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
      deletedAt: null,
      publishDate: { gte: params.from, lte: params.to },
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

  private async connectedStats(params: StatsParams) {
    const where: Prisma.IntegrationWhereInput = {
      deletedAt: null,
      createdAt: { gte: params.from, lte: params.to },
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

  async getStats(params: StatsParams): Promise<StatsResponse> {
    const [errors, posts, connected] = await Promise.all([
      this.errorStats(params),
      this.postStats(params),
      this.connectedStats(params),
    ]);

    return {
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      errors,
      posts,
      connected,
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

  async getGrowth(): Promise<GrowthResponse> {
    const now = new Date();
    const starts = windowStarts(now);
    const [funnel, organizations, channels] = await Promise.all([
      this.growthFunnel(starts),
      this.growthOrganizations(starts),
      this.growthChannels(starts),
    ]);

    return {
      generatedAt: now.toISOString(),
      funnel,
      organizations,
      channels,
    };
  }
}
