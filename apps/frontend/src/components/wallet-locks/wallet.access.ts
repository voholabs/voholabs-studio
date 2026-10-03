'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

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

export interface WalletPriceAction {
  key: string;
  provider: string | null;
  category: string;
  name: string;
  description: string | null;
  unit: string;
  freeUnits: number;
  freePeriod: string | null;
  billing: 'PER_USE' | 'MONTHLY' | 'UNLOCK' | string;
  requiresTopUp: boolean;
  // Hundredths of a credit.
  price: number;
}

export interface WalletPriceSection {
  key: string;
  actions: WalletPriceAction[];
}

export const useWalletPrices = (provider?: string, enabled = true) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(
      `/wallet/prices${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`
    );
    if (!response.ok) {
      return [] as WalletPriceSection[];
    }
    return (await response.json()) as WalletPriceSection[];
  }, [fetch, provider]);
  return useSWR<WalletPriceSection[]>(
    enabled ? `wallet-prices:${provider || ''}` : null,
    load,
    { revalidateOnFocus: false }
  );
};

export const findPrice = (
  sections: WalletPriceSection[] | undefined,
  key: string
) =>
  (sections || []).flatMap((section) => section.actions).find((a) => a.key === key);

// 225 -> "2.25"
export const formatCredits = (hundredths: number) =>
  (hundredths / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Matches the publish error the wallet writes when a post could not be paid
// for (notEnoughCreditsMessage in wallet.service.ts).
export const isNotEnoughCreditsError = (error?: string | null) =>
  !!error && /enough credits/i.test(error);
