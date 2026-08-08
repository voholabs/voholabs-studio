'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const BRIEF_CHANNELS_KEY = 'brief-channels';

export interface BriefChannel {
  id: string;
  name: string;
  identifier: string;
  picture: string;
  display?: string;
  disabled?: boolean;
  type?: string;
}

// The channel list is the connected integrations; a channel document exists only
// once it has been written to, so nothing here depends on the brief itself.
export const useBriefChannels = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await (await fetch('/integrations/list')).json()).integrations;
  }, [fetch]);

  return useSWR<BriefChannel[]>(BRIEF_CHANNELS_KEY, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    // Required alongside fallbackData: SWR treats the fallback as cached data
    // and, with revalidateIfStale off, would never fetch at all.
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
};
