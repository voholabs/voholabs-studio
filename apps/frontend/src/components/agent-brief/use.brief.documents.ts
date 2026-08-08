'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { BriefDocument } from '@gitroom/nestjs-libraries/agent-brief/brief.types';

export const BRIEF_DOCUMENTS_KEY = 'brief-documents';

export interface BriefDocumentsResponse {
  registryVersion: number;
  documents: BriefDocument[];
}

// Only documents that have been written to come back; everything else is
// rendered empty from the registry.
export const useBriefDocuments = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/brief')).json();
  }, [fetch]);

  return useSWR<BriefDocumentsResponse>(BRIEF_DOCUMENTS_KEY, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
