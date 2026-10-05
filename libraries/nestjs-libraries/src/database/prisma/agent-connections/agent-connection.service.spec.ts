import { AgentConnectionService } from '@gitroom/nestjs-libraries/database/prisma/agent-connections/agent-connection.service';

const repo = () => ({
  record: jest.fn(),
  getOrganizationStamps: jest.fn(),
  latestConnection: jest.fn(),
  countConnectedOrganizations: jest.fn(async (since?: Date) => {
    if (!since) return 40;
    const days = Math.round(
      (Date.parse('2026-10-05T00:00:00Z') - since.getTime()) / 86400000
    );
    return { 1: 3, 7: 9, 30: 21 }[days as 1 | 7 | 30];
  }),
  countFirstConnectedSince: jest.fn(async (since: Date) => {
    const days = Math.round(
      (Date.parse('2026-10-05T00:00:00Z') - since.getTime()) / 86400000
    );
    return { 7: 2, 30: 6 }[days as 7 | 30];
  }),
  countByClient: jest.fn(async () => [
    { key: 'claude', orgs: 30, active30d: 15 },
    { key: 'chatgpt', orgs: 10, active30d: 6 },
  ]),
  countByAuthMethod: jest.fn(async () => [
    { key: 'API_KEY', orgs: 35, active30d: 19 },
    { key: 'OAUTH', orgs: 5, active30d: 2 },
  ]),
  backfillCandidates: jest.fn(),
  applyBackfill: jest.fn(),
});

describe('AgentConnectionService', () => {
  it('returns the admin counts', async () => {
    const r = repo();
    const service = new AgentConnectionService(r as any);
    const stats = await service.stats(new Date('2026-10-05T00:00:00Z'));
    expect(stats.organizations).toEqual({
      everConnected: 40,
      seenLast1d: 3,
      seenLast7d: 9,
      seenLast30d: 21,
      firstConnectedLast7d: 2,
      firstConnectedLast30d: 6,
    });
    expect(stats.byClient[0]).toEqual({
      key: 'claude',
      orgs: 30,
      active30d: 15,
    });
    expect(stats.byAuthMethod.map((b) => b.key)).toEqual(['API_KEY', 'OAUTH']);
  });

  it('reports waiting until an agent has connected', async () => {
    const r = repo();
    r.getOrganizationStamps.mockResolvedValue({
      agentFirstConnectedAt: null,
      agentLastSeenAt: null,
    });
    r.latestConnection.mockResolvedValue(null);
    const service = new AgentConnectionService(r as any);
    expect(await service.status('org1')).toEqual({ connected: false });
  });

  it('reports the latest client once connected', async () => {
    const r = repo();
    const at = new Date('2026-10-05T10:00:00Z');
    r.getOrganizationStamps.mockResolvedValue({
      agentFirstConnectedAt: at,
      agentLastSeenAt: at,
    });
    r.latestConnection.mockResolvedValue({
      client: 'claude',
      authMethod: 'API_KEY',
      lastSeenAt: at,
    });
    const service = new AgentConnectionService(r as any);
    expect(await service.status('org1')).toEqual({
      connected: true,
      client: 'claude',
      authMethod: 'API_KEY',
      firstConnectedAt: at,
      lastSeenAt: at,
    });
  });

  describe('backfill', () => {
    const d = (s: string) => new Date(s);
    const candidates = [
      // Never stamped: newly connected.
      {
        organizationId: 'a',
        firstPostAt: d('2026-08-01'),
        lastPostAt: d('2026-09-01'),
        agentFirstConnectedAt: null,
        agentLastSeenAt: null,
      },
      // Stamped later than its first MCP post: moved earlier.
      {
        organizationId: 'b',
        firstPostAt: d('2026-08-01'),
        lastPostAt: d('2026-08-02'),
        agentFirstConnectedAt: d('2026-10-04'),
        agentLastSeenAt: d('2026-10-04'),
      },
      // Already right: left alone.
      {
        organizationId: 'c',
        firstPostAt: d('2026-09-01'),
        lastPostAt: d('2026-09-02'),
        agentFirstConnectedAt: d('2026-08-01'),
        agentLastSeenAt: d('2026-10-04'),
      },
    ];

    it('only reports without apply', async () => {
      const r = repo();
      r.backfillCandidates.mockResolvedValue(candidates);
      const service = new AgentConnectionService(r as any);
      expect(await service.backfill(false)).toEqual({
        dryRun: true,
        organizationsWithMcpPosts: 3,
        organizationsToUpdate: 2,
        newlyConnected: 1,
      });
      expect(r.applyBackfill).not.toHaveBeenCalled();
    });

    it('writes the organizations that need it with apply', async () => {
      const r = repo();
      r.backfillCandidates.mockResolvedValue(candidates);
      const service = new AgentConnectionService(r as any);
      const result = await service.backfill(true);
      expect(result.dryRun).toBe(false);
      expect(
        r.applyBackfill.mock.calls.map((c) => c[0].organizationId)
      ).toEqual(['a', 'b']);
    });
  });
});
