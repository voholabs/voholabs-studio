'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  OPEN_TOP_UP,
  openTopUp as openWalletTopUp,
  walletEvents,
} from '@gitroom/frontend/components/wallet/wallet.events';

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

// Opens the wallet's top-up dialog (wallet.events, listened to by
// <WalletHost />). When the dialog is not mounted on this screen, the browser
// goes to the wallet page, which opens it.
export const openTopUp = (message?: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  if (walletEvents.listenerCount(OPEN_TOP_UP) > 0) {
    openWalletTopUp(message ? { context: message } : {});
    return;
  }
  window.location.href = '/wallet?topup=open';
};
