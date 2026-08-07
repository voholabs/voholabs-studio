'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const HERMES_SETTINGS_KEY = 'hermes-settings';

export interface HermesSettingsResponse {
  // Whether the team has an agent connected. The endpoint and the key are
  // deliberately not part of this response — once set, they stay on the server.
  configured: boolean;
}

export const useHermesSettings = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/hermes')).json();
  }, [fetch]);

  return useSWR<HermesSettingsResponse>(HERMES_SETTINGS_KEY, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
