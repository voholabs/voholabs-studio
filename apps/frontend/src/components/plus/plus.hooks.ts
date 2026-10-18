'use client';

import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useRefreshWallet } from '@gitroom/frontend/components/wallet/wallet.hooks';
import { clockOffset } from '@gitroom/frontend/components/plus/plus.countdown';
import {
  PlusIntervalKey,
  PlusPlan,
} from '@gitroom/frontend/components/plus/plus.types';

// Starts with the wallet prefix, so refreshing the wallet refreshes it too.
export const PLUS_KEY = 'wallet-plus';

const withOffset = (body: Omit<PlusPlan, 'clockOffsetMs'>): PlusPlan => ({
  ...body,
  clockOffsetMs: clockOffset(body?.serverNow),
});

// GET /wallet/plus: the offer, the early bird, the subscription and the two
// kinds of credit. Pass false to skip the request (paid plans).
export const usePlusPlan = (enabled = true) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/wallet/plus');
    if (!res.ok) {
      throw new Error(`${res.status}`);
    }
    return withOffset(await res.json());
  }, [fetch]);
  return useSWR<PlusPlan>(enabled ? PLUS_KEY : null, load, {
    revalidateOnFocus: true,
    revalidateOnReconnect: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

// Writes a fresh plan into the cache and refreshes the wallet and the user
// (payAsYouGo, plus) behind it.
export const useApplyPlusPlan = () => {
  const { mutate } = useSWRConfig();
  const refreshWallet = useRefreshWallet();
  return useCallback(
    async (body?: Omit<PlusPlan, 'clockOffsetMs'>) => {
      if (body?.serverNow) {
        await mutate(PLUS_KEY, withOffset(body), { revalidate: false });
      }
      await refreshWallet();
    },
    [mutate, refreshWallet]
  );
};

// The Plus actions: Checkout (returns the Stripe URL), the browser's return
// from it, cancel, resume and the billing portal. Each resolves with { ok, body }.
export const usePlusActions = () => {
  const fetch = useFetch();
  const call = useCallback(
    async (path: string, init: RequestInit = {}) => {
      try {
        const res = await fetch(path, init);
        const body = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, body };
      } catch {
        return { ok: false, status: 0, body: {} as any };
      }
    },
    [fetch]
  );
  return {
    checkout: useCallback(
      (interval: PlusIntervalKey) =>
        call('/wallet/plus/checkout', {
          method: 'POST',
          body: JSON.stringify({ interval }),
        }),
      [call]
    ),
    confirm: useCallback(
      (sessionId: string) =>
        call(`/wallet/plus/checkout/${encodeURIComponent(sessionId)}`),
      [call]
    ),
    cancel: useCallback(
      () => call('/wallet/plus/cancel', { method: 'POST' }),
      [call]
    ),
    resume: useCallback(
      () => call('/wallet/plus/resume', { method: 'POST' }),
      [call]
    ),
    // The Stripe billing portal, to update the card after a failed payment.
    billing: useCallback(
      () => call('/wallet/plus/billing', { method: 'POST' }),
      [call]
    ),
  };
};
