'use client';

import { useMemo } from 'react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useWalletPrices } from '@gitroom/frontend/components/wallet/wallet.hooks';
import { WalletPriceSection } from '@gitroom/frontend/components/wallet/wallet.types';

// plan: a paid plan (or an instance without billing). Never sees the wallet.
// payg: free plan with paid features open: Plus, a workspace that topped up
// before Plus launched (at any balance), or one with top-up credit left
// (payAsYouGo on /user/self).
// free: free plan without Plus; those features show locked.
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

// Lock and coins colour. Anything that costs money or needs Plus (a
// pay-per-use price, a feature Plus opens) carries the warm
// accent; the tone type stays so a second accent can come back in one place.
export type WalletTone = 'warm';

export const toneFor = (_billing?: string | null): WalletTone => 'warm';

export const TONE_TEXT: Record<WalletTone, string> = {
  warm: 'text-warm',
};

export const TONE_SOFT: Record<WalletTone, string> = {
  warm: 'bg-warmSoft',
};

// Providers whose channels charge per use, from the price rows. Their
// connected channels keep a warm ring wherever channels are listed or
// picked. Empty for paid plans.
export const usePerUseProviders = (): Set<string> => {
  const access = useWalletAccess();
  const walletOrg = access === 'free' || access === 'payg';
  const { data } = useWalletPrices(walletOrg);
  return useMemo(
    () =>
      new Set(
        walletOrg
          ? (data || [])
              .flatMap((s) => s.actions)
              .filter((a) => !!a.provider && a.billing === 'PER_USE')
              .map((a) => a.provider as string)
          : []
      ),
    [data, walletOrg]
  );
};

// Providers Plus opens (a price row with requiresTopUp), for a free-plan
// workspace without Plus: they show a lock wherever channels are added or
// listed. Empty with Plus, and on paid plans.
export const useTopUpProviders = (): Set<string> => {
  const access = useWalletAccess();
  const { data } = useWalletPrices(access === 'free');
  return useMemo(
    () =>
      new Set(
        access === 'free'
          ? (data || [])
              .flatMap((s) => s.actions)
              .filter((a) => !!a.provider && a.requiresTopUp)
              .map((a) => a.provider as string)
          : []
      ),
    [data, access]
  );
};

// Providers whose channels are not free on the free plan, from the price
// rows: Plus opens them (requiresTopUp) or each post is charged (PER_USE).
// Read from the rows whatever the workspace's plan, since being free is
// about the channel.
export const paidChannelProviders = (
  sections: WalletPriceSection[]
): Set<string> =>
  new Set(
    sections
      .flatMap((s) => s.actions)
      .filter(
        (a) => !!a.provider && (a.requiresTopUp || a.billing === 'PER_USE')
      )
      .map((a) => a.provider as string)
  );

// What one post to a channel costs, as the lowest and highest of its
// posting rows (unit "post", e.g. with and without a link), in hundredths of
// a credit; null without any. Reads, reposts and lookups of the same
// provider are other units, so they never count.
export const postPriceRange = (
  sections: WalletPriceSection[],
  identifier: string
): { low: number; high: number } | null => {
  const amounts = sections
    .flatMap((s) => s.actions)
    .filter((a) => a.key.startsWith(`${identifier}.`) && a.unit === 'post')
    .map((a) => a.price);
  return amounts.length
    ? { low: Math.min(...amounts), high: Math.max(...amounts) }
    : null;
};

// Of the providers Plus opens, the ones among the selected channels, in the
// order they were selected: the composer's lock line names only these.
export const lockedAmongSelected = (
  locked: Set<string>,
  selected: string[]
): string[] => [...new Set(selected.filter((id) => locked.has(id)))];

// The channels onboarding and Add Channel tag "Free": every provider without
// such a row. Undefined until the price rows load, so no tag flashes on a paid
// channel, and without any rows (an instance without the wallet).
export const useFreeChannel = ():
  | ((identifier: string) => boolean)
  | undefined => {
  const { data } = useWalletPrices();
  return useMemo(() => {
    if (!data?.length) {
      return undefined;
    }
    const paid = paidChannelProviders(data);
    return (identifier: string) => !paid.has(identifier);
  }, [data]);
};

// The ring itself: warm, outside the avatar, so a selection border inside
// it still shows.
export const PER_USE_RING = 'ring-[2px] ring-warm';
