import { proxyActivities, sleep } from '@temporalio/workflow';
import { WalletActivity } from '@gitroom/orchestrator/activities/wallet.activity';

const { plusEarlyBirdEmailDelay, sendPlusEarlyBirdEmail } =
  proxyActivities<WalletActivity>({
    startToCloseTimeout: '10 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });

// One per workspace (workflow id plus_early_bird_<org>), started when its
// welcome credits are claimed or skipped: waits for the early bird's first window to
// end, then sends the one email saying it was extended. The activity checks
// everything again when it runs (the setting, Plus, once only).
export async function plusEarlyBirdEmailWorkflow({
  organizationId,
}: {
  organizationId: string;
}) {
  const wait = await plusEarlyBirdEmailDelay(organizationId);
  if (wait === null || wait === undefined) {
    return;
  }
  await sleep(wait);
  await sendPlusEarlyBirdEmail(organizationId);
}
