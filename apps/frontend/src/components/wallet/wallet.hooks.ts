'use client';

import { useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useTranslation } from 'react-i18next';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { ENABLED_PROVIDERS } from '@gitroom/frontend/components/launches/add.provider.component';
import {
  SupportedChannel,
  WalletPriceSection,
  WalletSummary,
  WalletTransactions,
  WalletUsage,
} from '@gitroom/frontend/components/wallet/wallet.types';

// Every wallet SWR key starts with this, so one call refreshes them all.
export const WALLET_KEY = 'wallet-summary';
const WALLET_PREFIX = 'wallet-';

const useJson = () => {
  const fetch = useFetch();
  return useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      return res.json();
    },
    [fetch]
  );
};

const quiet = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
};

// The wallet summary (GET /wallet). Pass false to skip the request.
export const useWallet = (enabled = true) => {
  const json = useJson();
  const load = useCallback(() => json('/wallet'), [json]);
  return useSWR<WalletSummary>(enabled ? WALLET_KEY : null, load, quiet);
};

export const useWalletTransactions = (
  page: number,
  size: number,
  enabled = true
) => {
  const json = useJson();
  const load = useCallback(
    () => json(`/wallet/transactions?page=${page}&size=${size}`),
    [json, page, size]
  );
  return useSWR<WalletTransactions>(
    enabled ? `${WALLET_PREFIX}transactions-${page}-${size}` : null,
    load,
    { ...quiet, keepPreviousData: true }
  );
};

export const useWalletUsage = (days: number, enabled = true) => {
  const json = useJson();
  const load = useCallback(
    () => json(`/wallet/usage?days=${days}`),
    [json, days]
  );
  return useSWR<WalletUsage>(
    enabled ? `${WALLET_PREFIX}usage-${days}` : null,
    load,
    { ...quiet, keepPreviousData: true }
  );
};

export const useWalletPrices = (enabled = true) => {
  const json = useJson();
  const load = useCallback(() => json('/wallet/prices'), [json]);
  return useSWR<WalletPriceSection[]>(
    enabled ? `${WALLET_PREFIX}prices` : null,
    load,
    quiet
  );
};

// Channels the app can connect today: the provider list, narrowed to the
// ones the Add Channel dialog enables.
export const useSupportedChannels = (enabled = true) => {
  const json = useJson();
  const load = useCallback(async () => {
    const data = await json('/integrations');
    return ((data?.social || []) as SupportedChannel[])
      .filter((p) => ENABLED_PROVIDERS.includes(p.identifier))
      .map((p) => ({ identifier: p.identifier, name: p.name }));
  }, [json]);
  return useSWR<SupportedChannel[]>(
    enabled ? `${WALLET_PREFIX}supported-channels` : null,
    load,
    quiet
  );
};

// Refreshes every wallet query and the signed-in user (payAsYouGo).
export const useRefreshWallet = () => {
  const { mutate } = useSWRConfig();
  return useCallback(
    async (summary?: WalletSummary) => {
      await Promise.all([
        summary
          ? mutate(WALLET_KEY, summary, { revalidate: false })
          : mutate(WALLET_KEY),
        mutate(
          (key) =>
            typeof key === 'string' &&
            key.startsWith(WALLET_PREFIX) &&
            key !== WALLET_KEY &&
            !key.endsWith('prices') &&
            !key.endsWith('supported-channels')
        ),
        mutate('/user/self'),
      ]);
    },
    [mutate]
  );
};

export const fractionDigits = (currency: string) => {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
};

// Number, money and date formatting for the wallet, in the current language
// and the wallet's currency (never a literal currency symbol).
export const useWalletFormat = (currency?: string) => {
  const { i18n } = useTranslation();
  const locale = i18n?.language || 'en';
  return useMemo(() => {
    const safe = (fn: () => Intl.NumberFormat) => {
      try {
        return fn();
      } catch {
        return null;
      }
    };
    const twoDp = safe(
      () =>
        new Intl.NumberFormat(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
    );
    const whole = safe(() => new Intl.NumberFormat(locale));
    const money = currency
      ? safe(
          () => new Intl.NumberFormat(locale, { style: 'currency', currency })
        )
      : null;
    const moneyShort = currency
      ? safe(
          () =>
            new Intl.NumberFormat(locale, {
              style: 'currency',
              currency,
              minimumFractionDigits: 0,
            })
        )
      : null;
    const digits = currency ? fractionDigits(currency) : 2;
    const factor = Math.pow(10, digits);
    const dateTime = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const dayMonth = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    const dayMonthYear = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const monthName = new Intl.DateTimeFormat(locale, { month: 'short' });

    return {
      locale,
      // Hundredths of a credit -> "1,234.50"
      credits: (hundredths: number) =>
        twoDp ? twoDp.format(hundredths / 100) : (hundredths / 100).toFixed(2),
      number: (n: number) => (whole ? whole.format(n) : String(n)),
      // Smallest currency unit -> "$12.50"
      money: (minor: number) => (money ? money.format(minor / factor) : ''),
      // Smallest currency unit -> "$10" when whole, "$12.50" otherwise
      moneyShort: (minor: number) =>
        moneyShort ? moneyShort.format(minor / factor) : '',
      currencySymbol: () =>
        money?.formatToParts(0).find((p) => p.type === 'currency')?.value || '',
      // Minor units per major unit of the currency (100 for USD).
      factor,
      digits,
      // Hundredths of a credit bought with an amount in minor currency units.
      creditsFor: (minor: number, creditsPerUnit: number) =>
        Math.round((minor * creditsPerUnit * 100) / factor),
      // Minor currency units worth an amount in hundredths of a credit.
      moneyFor: (hundredths: number, creditsPerUnit: number) =>
        Math.round((hundredths * factor) / (creditsPerUnit * 100)),
      dateTime: (iso: string) => dateTime.format(new Date(iso)),
      dayMonth: (d: Date) => dayMonth.format(d),
      dayMonthYear: (d: Date) => dayMonthYear.format(d),
      monthName: (d: Date) => monthName.format(d),
    };
  }, [locale, currency]);
};

export type WalletFormat = ReturnType<typeof useWalletFormat>;
