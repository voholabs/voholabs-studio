'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { BrainDocument } from '@gitroom/nestjs-libraries/agent-brain/brain.types';

export const BRAIN_DOCUMENTS_KEY = 'brain-documents';

export interface BrainDocumentsResponse {
  registryVersion: number;
  documents: BrainDocument[];
}

// Only documents that have been written to come back; everything else is
// rendered empty from the registry.
export const useBrainDocuments = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/brain')).json();
  }, [fetch]);

  return useSWR<BrainDocumentsResponse>(BRAIN_DOCUMENTS_KEY, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
