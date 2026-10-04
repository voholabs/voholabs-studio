'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import {
  findAction,
  useWalletPrices,
} from '@gitroom/frontend/components/wallet/wallet.hooks';

// plan: a paid plan (or an instance without billing). Never sees the wallet.
// payg: free plan with a wallet top-up; X, the brief and skills are open.
// free: free plan, nothing topped up; those features show locked.
export type WalletAccess = 'plan' | 'payg' | 'free';

export const useWalletAccess = (): WalletAccess | undefined => {
  const user = useUser();
  if (!user?.tier?.current) {
    return undefined;
  }
  if (user.tier.current !== 'FREE') {
    return 'plan';
  }
  // @ts-ignore - sent by /user/self, not part of the Prisma user
  return user.payAsYouGo ? 'payg' : 'free';
};

// Lock and coins colour, derived from how something is billed: warm for
// pay-per-use (PER_USE, MONTHLY), teal for what a top-up opens once.
export type WalletTone = 'warm' | 'teal';

export const toneFor = (billing?: string | null): WalletTone =>
  billing === 'PER_USE' || billing === 'MONTHLY' ? 'warm' : 'teal';

export const TONE_TEXT: Record<WalletTone, string> = {
  warm: 'text-warm',
  teal: 'text-tealText',
};

export const TONE_SOFT: Record<WalletTone, string> = {
  warm: 'bg-warmSoft',
  teal: 'bg-tealSoft',
};

// Opening a feature is a one-time unlock even if using it later has a price,
// so a feature's lock follows the row that opens it (none: an unlock).
const FEATURE_UNLOCK_ACTION: Record<string, string | undefined> = {
  brief: undefined,
  skills: 'skills.library',
};

export const isFeature = (key: string) => key in FEATURE_UNLOCK_ACTION;

export const useFeatureTone = (feature: string): WalletTone => {
  const actionKey = FEATURE_UNLOCK_ACTION[feature];
  const { data } = useWalletPrices(!!actionKey);
  return toneFor(
    actionKey ? findAction(data, actionKey)?.billing || 'UNLOCK' : 'UNLOCK'
  );
};

// The tone of one priced action (e.g. a channel's per-post price), or the
// fallback while prices load.
export const useActionTone = (
  actionKey: string,
  fallback: WalletTone = 'warm',
  enabled = true
): WalletTone => {
  const { data } = useWalletPrices(enabled);
  const action = findAction(data, actionKey);
  return action ? toneFor(action.billing) : fallback;
};
