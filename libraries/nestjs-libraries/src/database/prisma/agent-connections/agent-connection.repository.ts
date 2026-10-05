import { Injectable } from '@nestjs/common';
import { AgentAuthMethod } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface RecordConnectionInput {
  organizationId: string;
  client: string;
  authMethod: AgentAuthMethod;
  at: Date;
  // Requests since the row was last written.
  requests: number;
  toolName?: string;
}

export interface AgentConnectionCountRow {
  key: string;
  orgs: number;
  active30d: number;
}

export interface BackfillCandidate {
  organizationId: string;
  firstPostAt: Date;
  lastPostAt: Date;
  agentFirstConnectedAt: Date | null;
  agentLastSeenAt: Date | null;
}

@Injectable()
export class AgentConnectionRepository {
  constructor(
    private _agentConnection: PrismaRepository<
      'agentConnection' | '$executeRaw' | '$queryRaw'
    >,
    private _organization: PrismaRepository<'organization'>,
    private _post: PrismaRepository<'post'>
  ) {}

  // Upserts the row, then stamps the organization. Returns whether this was
  // the organization's first agent connection ever. The organization is
  // written with raw SQL so its updatedAt is left alone, and the first-time
  // stamp is a conditional update, so two processes cannot both claim it.
  async record(input: RecordConnectionInput): Promise<{ first: boolean }> {
    const { organizationId, client, authMethod, at, requests, toolName } =
      input;

    await this._agentConnection.model.agentConnection.upsert({
      where: {
        organizationId_client_authMethod: {
          organizationId,
          client,
          authMethod,
        },
      },
      create: {
        organizationId,
        client,
        authMethod,
        firstSeenAt: at,
        lastSeenAt: at,
        requestCount: requests,
        lastToolName: toolName || null,
      },
      update: {
        lastSeenAt: at,
        requestCount: { increment: requests },
        ...(toolName ? { lastToolName: toolName } : {}),
      },
    });

    const first = await this._agentConnection.model.$executeRaw`
      UPDATE "Organization"
      SET "agentFirstConnectedAt" = ${at}, "agentLastSeenAt" = ${at}
      WHERE "id" = ${organizationId} AND "agentFirstConnectedAt" IS NULL`;

    if (!first) {
      await this._agentConnection.model.$executeRaw`
        UPDATE "Organization"
        SET "agentLastSeenAt" = ${at}
        WHERE "id" = ${organizationId}
          AND ("agentLastSeenAt" IS NULL OR "agentLastSeenAt" < ${at})`;
    }

    return { first: first > 0 };
  }

  getOrganizationStamps(organizationId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: organizationId },
      select: { agentFirstConnectedAt: true, agentLastSeenAt: true },
    });
  }

  latestConnection(organizationId: string) {
    return this._agentConnection.model.agentConnection.findFirst({
      where: { organizationId },
      orderBy: { lastSeenAt: 'desc' },
      select: { client: true, authMethod: true, lastSeenAt: true },
    });
  }

  countConnectedOrganizations(since?: Date) {
    return this._organization.model.organization.count({
      where: since
        ? { agentLastSeenAt: { gte: since } }
        : { agentFirstConnectedAt: { not: null } },
    });
  }

  countFirstConnectedSince(since: Date) {
    return this._organization.model.organization.count({
      where: { agentFirstConnectedAt: { gte: since } },
    });
  }

  // Organizations per client: ever, and seen in the last 30 days.
  async countByClient(since30d: Date): Promise<AgentConnectionCountRow[]> {
    const rows = await this._agentConnection.model.$queryRaw<
      Array<{ key: string; orgs: bigint; active30d: bigint }>
    >`
      SELECT "client" AS "key",
        COUNT(DISTINCT "organizationId") AS "orgs",
        COUNT(DISTINCT "organizationId") FILTER (WHERE "lastSeenAt" >= ${since30d}) AS "active30d"
      FROM "AgentConnection"
      GROUP BY "client"
      ORDER BY "orgs" DESC`;
    return rows.map((r) => ({
      key: r.key,
      orgs: Number(r.orgs),
      active30d: Number(r.active30d),
    }));
  }

  async countByAuthMethod(since30d: Date): Promise<AgentConnectionCountRow[]> {
    const rows = await this._agentConnection.model.$queryRaw<
      Array<{ key: string; orgs: bigint; active30d: bigint }>
    >`
      SELECT "authMethod"::text AS "key",
        COUNT(DISTINCT "organizationId") AS "orgs",
        COUNT(DISTINCT "organizationId") FILTER (WHERE "lastSeenAt" >= ${since30d}) AS "active30d"
      FROM "AgentConnection"
      GROUP BY "authMethod"
      ORDER BY "orgs" DESC`;
    return rows.map((r) => ({
      key: r.key,
      orgs: Number(r.orgs),
      active30d: Number(r.active30d),
    }));
  }

  // Every organization that has a post created over the MCP, with the first
  // and last such post and what the organization already holds. Read only.
  async backfillCandidates(): Promise<BackfillCandidate[]> {
    const grouped = await this._post.model.post.groupBy({
      by: ['organizationId'],
      where: { creationMethod: 'MCP' },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    if (!grouped.length) {
      return [];
    }
    const orgs = await this._organization.model.organization.findMany({
      where: { id: { in: grouped.map((g) => g.organizationId) } },
      select: { id: true, agentFirstConnectedAt: true, agentLastSeenAt: true },
    });
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return grouped
      .filter((g) => byId.has(g.organizationId) && g._min.createdAt)
      .map((g) => ({
        organizationId: g.organizationId,
        firstPostAt: g._min.createdAt!,
        lastPostAt: g._max.createdAt || g._min.createdAt!,
        agentFirstConnectedAt: byId.get(g.organizationId)!
          .agentFirstConnectedAt,
        agentLastSeenAt: byId.get(g.organizationId)!.agentLastSeenAt,
      }));
  }

  // Writes only the new columns and table: moves the organization's stamps
  // earlier/later where the posts show it, and adds an `unknown` row when the
  // organization has no row yet.
  async applyBackfill(candidate: BackfillCandidate) {
    const { organizationId, firstPostAt, lastPostAt } = candidate;
    await this._agentConnection.model.$executeRaw`
      UPDATE "Organization"
      SET "agentFirstConnectedAt" = LEAST(COALESCE("agentFirstConnectedAt", ${firstPostAt}), ${firstPostAt}),
          "agentLastSeenAt" = GREATEST(COALESCE("agentLastSeenAt", ${lastPostAt}), ${lastPostAt})
      WHERE "id" = ${organizationId}`;

    const existing = await this._agentConnection.model.agentConnection.count({
      where: { organizationId },
    });
    if (!existing) {
      await this._agentConnection.model.agentConnection.createMany({
        data: [
          {
            organizationId,
            client: 'unknown',
            authMethod: 'UNKNOWN',
            firstSeenAt: firstPostAt,
            lastSeenAt: lastPostAt,
            requestCount: 0,
          },
        ],
        skipDuplicates: true,
      });
    }
  }
}
