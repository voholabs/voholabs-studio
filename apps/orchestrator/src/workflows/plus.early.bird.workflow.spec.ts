// The early-bird email workflow with its activities stubbed: it waits for
// the first window to end, then asks the activity to send (which checks
// everything again and sends once).
const delay = jest.fn();
const send = jest.fn(async () => true);
const sleep = jest.fn(async (_ms: number) => undefined);
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({
    plusEarlyBirdEmailDelay: delay,
    sendPlusEarlyBirdEmail: send,
  }),
  sleep: (ms: number) => sleep(ms),
}));
jest.mock('@gitroom/orchestrator/activities/wallet.activity', () => ({
  WalletActivity: class {},
}));

import { plusEarlyBirdEmailWorkflow } from '@gitroom/orchestrator/workflows/plus.early.bird.workflow';

describe('plusEarlyBirdEmailWorkflow', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sleeps until the extension starts, then sends', async () => {
    delay.mockResolvedValueOnce(3_600_000);
    await plusEarlyBirdEmailWorkflow({ organizationId: 'org-1' });
    expect(delay).toHaveBeenCalledWith('org-1');
    expect(sleep).toHaveBeenCalledWith(3_600_000);
    expect(send).toHaveBeenCalledWith('org-1');
  });

  it('sends nothing when there is no extension to tell about', async () => {
    delay.mockResolvedValueOnce(null);
    await plusEarlyBirdEmailWorkflow({ organizationId: 'org-1' });
    expect(sleep).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
