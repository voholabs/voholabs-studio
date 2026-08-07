'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const HERMES_CONVERSATIONS_KEY = 'hermes-conversations';

export interface HermesConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export const useHermesConversations = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/hermes/conversations')).json();
  }, [fetch]);

  return useSWR<HermesConversationSummary[]>(HERMES_CONVERSATIONS_KEY, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
};
