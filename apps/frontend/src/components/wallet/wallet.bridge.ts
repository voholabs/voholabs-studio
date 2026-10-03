'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

// The meeting point between the screens that send people to the wallet
// (locks, composer, 402 handler) and the wallet itself (summary, top-up).

export interface WalletSummary {
  balance: number;
  payAsYouGo: boolean;
  frozen?: boolean;
  currency?: string;
  paymentsEnabled: boolean;
  topUp: {
    minAmount: number;
    options: number[];
    creditsPerUnit: number;
  } | null;
  card: { brand: string; last4: string } | null;
  autoTopUp: {
    enabled: boolean;
    threshold: number | null;
    amount?: number | null;
    monthlyCap: number | null;
    usedThisMonth: number;
  };
  forecast?: {
    windowHours: number;
    needed: number;
    short: boolean;
  };
}

export const WALLET_OPEN_TOPUP_EVENT = 'wallet:open-topup';

export interface OpenTopUpDetail {
  message?: string;
}

export const useWalletSummary = (enabled = true) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/wallet')).json() as Promise<WalletSummary>;
  }, [fetch]);
  return useSWR<WalletSummary>(enabled ? 'wallet-summary' : null, load, {
    revalidateOnFocus: true,
  });
};

// The wallet listens for this event and opens its top-up dialog. A listener
// claims the event with preventDefault(); when nothing does (the wallet is not
// mounted on this screen), the browser goes to the wallet page instead.
export const openTopUp = (message?: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  const event = new CustomEvent<OpenTopUpDetail>(WALLET_OPEN_TOPUP_EVENT, {
    detail: { message },
    cancelable: true,
  });
  const unclaimed = window.dispatchEvent(event);
  if (unclaimed) {
    window.location.href = '/wallet?topup=open';
  }
};
