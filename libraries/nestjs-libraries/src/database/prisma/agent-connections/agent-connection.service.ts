import { Injectable } from '@nestjs/common';
import {
  AgentConnectionRepository,
  RecordConnectionInput,
} from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.repository';

const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AgentConnectionService {
  constructor(private _agentConnectionRepository: AgentConnectionRepository) {}

  record(input: RecordConnectionInput) {
    return this._agentConnectionRepository.record(input);
  }

  // What the connect-agent panel shows: has an agent reached the MCP for this
  // organization, which one, and when it was last seen.
  async status(organizationId: string) {
    const [stamps, latest] = await Promise.all([
      this._agentConnectionRepository.getOrganizationStamps(organizationId),
      this._agentConnectionRepository.latestConnection(organizationId),
    ]);
    if (!stamps?.agentFirstConnectedAt && !latest) {
      return { connected: false as const };
    }
    return {
      connected: true as const,
      client: latest?.client || null,
      authMethod: latest?.authMethod || null,
      firstConnectedAt: stamps?.agentFirstConnectedAt || null,
      lastSeenAt: latest?.lastSeenAt || stamps?.agentLastSeenAt || null,
    };
  }

  // The superadmin number: organizations with an agent connected, ever and
  // recently, split by client and by sign-in method.
  async stats(now = new Date()) {
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const repo = this._agentConnectionRepository;
    const [
      everConnected,
      active1d,
      active7d,
      active30d,
      new7d,
      new30d,
      byClient,
      byAuthMethod,
    ] = await Promise.all([
      repo.countConnectedOrganizations(),
      repo.countConnectedOrganizations(ago(1)),
      repo.countConnectedOrganizations(ago(7)),
      repo.countConnectedOrganizations(ago(30)),
      repo.countFirstConnectedSince(ago(7)),
      repo.countFirstConnectedSince(ago(30)),
      repo.countByClient(ago(30)),
      repo.countByAuthMethod(ago(30)),
    ]);
    return {
      generatedAt: now.toISOString(),
      organizations: {
        everConnected,
        seenLast1d: active1d,
        seenLast7d: active7d,
        seenLast30d: active30d,
        firstConnectedLast7d: new7d,
        firstConnectedLast30d: new30d,
      },
      byClient,
      byAuthMethod,
    };
  }

  // Dates the first connection of organizations that posted over the MCP
  // before connections were recorded. Without `apply` it only reports.
  async backfill(apply: boolean) {
    const candidates =
      await this._agentConnectionRepository.backfillCandidates();
    const changes = candidates.filter(
      (c) =>
        !c.agentFirstConnectedAt ||
        c.agentFirstConnectedAt > c.firstPostAt ||
        !c.agentLastSeenAt ||
        c.agentLastSeenAt < c.lastPostAt
    );
    const newlyConnected = candidates.filter(
      (c) => !c.agentFirstConnectedAt
    ).length;

    if (apply) {
      for (const candidate of changes) {
        await this._agentConnectionRepository.applyBackfill(candidate);
      }
    }

    return {
      dryRun: !apply,
      organizationsWithMcpPosts: candidates.length,
      organizationsToUpdate: changes.length,
      newlyConnected,
    };
  }
}
