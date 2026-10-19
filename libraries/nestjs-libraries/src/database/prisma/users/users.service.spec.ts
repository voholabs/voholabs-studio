import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';

// The onboarding steps against stub services: every step can be skipped,
// and only connecting the agent and having it fill at least one document of
// the brief earns the welcome credits.

const service = ({
  channels = 1,
  agent = true,
  briefDone = true,
  filled,
  skipped = false,
}: {
  channels?: number;
  agent?: boolean;
  briefDone?: boolean;
  // Which documents are filled, when not all or none.
  filled?: boolean[];
  skipped?: boolean;
} = {}) => {
  const users = {
    completeOnboarding: jest.fn(async () => ({ id: 'user1' })),
  };
  const wallet = {
    welcomeCredits: jest.fn(async () => ({
      available: skipped ? 0 : 10000,
      claimed: false,
      skipped,
    })),
    claimWelcomeCredits: jest.fn(async () => 10000),
    skipWelcomeCredits: jest.fn(async () => !skipped),
  };
  const plus = { startEarlyBird: jest.fn(async () => undefined) };
  const built = new UsersService(
    users as any,
    {} as any,
    {
      getIntegrationsList: jest.fn(async () =>
        Array.from({ length: channels }, (_, i) => ({ id: `i${i}` }))
      ),
    } as any,
    {} as any,
    { status: jest.fn(async () => ({ connected: agent })) } as any,
    {
      onboardingStatus: jest.fn(async () => ({
        done: filled ? filled.every(Boolean) : briefDone,
        documents: (filled || [briefDone]).map((isFilled, i) => ({
          key: `doc${i}`,
          label: `Document ${i}`,
          filled: isFilled,
        })),
      })),
    } as any,
    wallet as any,
    plus as any
  );
  return { built, users, wallet, plus };
};

describe('UsersService onboarding and welcome credits', () => {
  it('is eligible only when the agent is connected and the brief has content', async () => {
    for (const [agent, briefDone, eligible] of [
      [true, true, true],
      [false, true, false],
      [true, false, false],
      [false, false, false],
    ] as const) {
      const { built } = service({ agent, briefDone });
      const status = await built.onboardingStatus('org1', true, true);
      expect(status.credits).toEqual({
        available: 10000,
        claimed: false,
        skipped: false,
        eligible,
      });
    }
  });

  it('a member who is not an admin is never eligible', async () => {
    const { built } = service();
    expect(
      (await built.onboardingStatus('org1', false, true)).credits.eligible
    ).toBe(false);
  });

  it('a paid plan is never eligible, and cannot claim', async () => {
    const { built, wallet } = service();
    expect(
      (await built.onboardingStatus('org1', true, false)).credits.eligible
    ).toBe(false);
    await expect(
      built.claimWelcomeCredits('org1', true, false)
    ).rejects.toThrow();
    expect(wallet.claimWelcomeCredits).not.toHaveBeenCalled();
  });

  it('one filled document of several is enough for the credits', async () => {
    const { built, wallet } = service({ filled: [false, true, false] });
    const status = await built.onboardingStatus('org1', true, true);
    expect(status.brief.done).toBe(false);
    expect(status.credits.eligible).toBe(true);
    await expect(built.claimWelcomeCredits('org1', true, true)).resolves.toEqual(
      { credits: 100 }
    );
    expect(wallet.claimWelcomeCredits).toHaveBeenCalledWith('org1');
  });

  it('no filled document is not enough, with the agent connected', async () => {
    const { built, wallet } = service({ filled: [false, false, false] });
    const status = await built.onboardingStatus('org1', true, true);
    expect(status.credits.eligible).toBe(false);
    await expect(
      built.claimWelcomeCredits('org1', true, true)
    ).rejects.toThrow();
    expect(wallet.claimWelcomeCredits).not.toHaveBeenCalled();
  });

  it('finishes onboarding with the agent and the brief skipped', async () => {
    const { built, users, wallet } = service({
      agent: false,
      briefDone: false,
    });
    await built.completeOnboarding('user1', {});
    expect(users.completeOnboarding).toHaveBeenCalledWith('user1', {});
    // Finishing gives nothing: the credits come only from the claim.
    expect(wallet.claimWelcomeCredits).not.toHaveBeenCalled();
  });

  it('finishes onboarding with every step skipped, no channel at all', async () => {
    const { built, users } = service({
      channels: 0,
      agent: false,
      briefDone: false,
    });
    await built.completeOnboarding('user1', { attribution: 'x' });
    expect(users.completeOnboarding).toHaveBeenCalledWith('user1', {
      attribution: 'x',
    });
  });

  it('reports a missing channel without blocking anything', async () => {
    const { built } = service({ channels: 0 });
    const status = await built.onboardingStatus('org1', true, true);
    expect(status.channel).toBe(false);
    expect(status).not.toHaveProperty('done');
    // The credits wait on the agent and the brief only.
    expect(status.credits.eligible).toBe(true);
  });

  it('skipped steps never earn the credits, with or without a channel', async () => {
    const { built, wallet } = service({
      channels: 0,
      agent: false,
      briefDone: false,
    });
    await expect(built.claimWelcomeCredits('org1', true, true)).rejects.toThrow(
      'Connect your agent and let it fill in what it knows first'
    );
    expect(wallet.claimWelcomeCredits).not.toHaveBeenCalled();
  });

  it('refuses the claim when nothing in the brief is filled, checked on the server', async () => {
    const { built, wallet } = service({ briefDone: false });
    await expect(
      built.claimWelcomeCredits('org1', true, true)
    ).rejects.toThrow();
    expect(wallet.claimWelcomeCredits).not.toHaveBeenCalled();
  });

  it('refuses the claim once the credits were turned down', async () => {
    const { built, wallet } = service({ skipped: true });
    await expect(built.claimWelcomeCredits('org1', true, true)).rejects.toThrow(
      'The welcome credits were turned down'
    );
    expect(wallet.claimWelcomeCredits).not.toHaveBeenCalled();
  });

  it('only an admin can turn the credits down', async () => {
    const { built, wallet } = service();
    await expect(built.skipWelcomeCredits('org1', false)).rejects.toThrow();
    expect(wallet.skipWelcomeCredits).not.toHaveBeenCalled();
    await built.skipWelcomeCredits('org1', true);
    expect(wallet.skipWelcomeCredits).toHaveBeenCalledWith('org1');
  });

  it('a skip starts the Plus early bird, as a claim does', async () => {
    const { built, plus } = service();
    await built.skipWelcomeCredits('org1', true);
    expect(plus.startEarlyBird).toHaveBeenCalledWith('org1');
  });

  it('a skip that records nothing (already decided) starts nothing', async () => {
    const { built, wallet, plus } = service({ skipped: true });
    await built.skipWelcomeCredits('org1', true);
    expect(wallet.skipWelcomeCredits).toHaveBeenCalledWith('org1');
    expect(plus.startEarlyBird).not.toHaveBeenCalled();
  });

  it('the onboarding reopens only while the credits are undecided', async () => {
    expect(await service().built.welcomeCreditsPending('org1')).toBe(true);
    expect(
      await service({ skipped: true }).built.welcomeCreditsPending('org1')
    ).toBe(false);
  });

  it('claims when eligible and says how many credits were added', async () => {
    const { built, wallet, plus } = service();
    expect(await built.claimWelcomeCredits('org1', true, true)).toEqual({
      credits: 100,
    });
    expect(wallet.claimWelcomeCredits).toHaveBeenCalledWith('org1');
    // The Plus early bird starts with the claim.
    expect(plus.startEarlyBird).toHaveBeenCalledWith('org1');
  });

  it('starts no early bird when nothing was added (a second claim)', async () => {
    const { built, wallet, plus } = service();
    wallet.claimWelcomeCredits.mockResolvedValueOnce(0);
    await built.claimWelcomeCredits('org1', true, true);
    expect(plus.startEarlyBird).not.toHaveBeenCalled();
  });
});
