import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';

// The onboarding steps against stub services: every step can be skipped,
// finishing gives no credits, and a free-plan admin finishing starts the
// Plus early bird.

const service = ({
  channels = 1,
  agent = true,
  briefDone = true,
  filled,
}: {
  channels?: number;
  agent?: boolean;
  briefDone?: boolean;
  // Which documents are filled, when not all or none.
  filled?: boolean[];
} = {}) => {
  const users = {
    completeOnboarding: jest.fn(async () => ({ count: 1 })),
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
    plus as any
  );
  return { built, users, plus };
};

describe('UsersService onboarding', () => {
  it('reports the channel, the agent and the brief, and no credits', async () => {
    const { built } = service({ filled: [false, true, false] });
    const status = await built.onboardingStatus('org1');
    expect(status.channel).toBe(true);
    expect(status.agent).toBe(true);
    expect(status.brief.done).toBe(false);
    expect(status).not.toHaveProperty('credits');
  });

  it('reports a missing channel without blocking anything', async () => {
    const { built } = service({ channels: 0 });
    const status = await built.onboardingStatus('org1');
    expect(status.channel).toBe(false);
    expect(status).not.toHaveProperty('done');
  });

  it('finishes onboarding with every step skipped, no channel at all', async () => {
    const { built, users } = service({
      channels: 0,
      agent: false,
      briefDone: false,
    });
    await built.completeOnboarding('user1', { attribution: 'x' }, 'org1', true);
    expect(users.completeOnboarding).toHaveBeenCalledWith('user1', {
      attribution: 'x',
    });
  });

  it('finishing starts the Plus early bird when asked to', async () => {
    const { built, plus } = service();
    await built.completeOnboarding('user1', {}, 'org1', true);
    expect(plus.startEarlyBird).toHaveBeenCalledWith('org1');
  });

  it('finishing again starts no early bird', async () => {
    const { built, users, plus } = service();
    users.completeOnboarding.mockResolvedValueOnce({ count: 0 });
    await built.completeOnboarding('user1', {}, 'org1', true);
    expect(plus.startEarlyBird).not.toHaveBeenCalled();
  });

  it('finishing starts no early bird for a member or a paid plan', async () => {
    const { built, plus } = service();
    await built.completeOnboarding('user1', {}, 'org1', false);
    expect(plus.startEarlyBird).not.toHaveBeenCalled();
  });
});
