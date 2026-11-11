import { HttpException } from '@nestjs/common';
import { paidOnly } from '@gitroom/nestjs-libraries/chat/auth.context';
import { plusUrl } from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

// Flows (the library and My flows) open with Plus, under the "flows" key a
// price row opens (WalletService.unlockedKeys). The tools stay listed for
// everyone and refuse here, with the upgrade link, for the gateway to pass
// on as plus_required.
export const flowsLocked = (context: any) =>
  paidOnly(context, 'Flows', 'flows')
    ? {
        error: `Flows are included with Plus: ${plusUrl()}`,
        code: 'plus_required' as const,
        upgradeUrl: plusUrl(),
      }
    : null;

// What a failed flow call says: the service's own reason for a bad input or
// a missing flow, otherwise a retry.
export const flowError = (err: unknown) => ({
  error:
    err instanceof HttpException && err.getStatus() < 500
      ? err.message
      : 'Could not reach the flows right now. Try again shortly.',
});
