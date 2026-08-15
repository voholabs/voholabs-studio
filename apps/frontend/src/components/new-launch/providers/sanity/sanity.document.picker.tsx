'use client';

import useSWR from 'swr';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';

export type SanityDocument = {
  id: string;
  type: string;
  title: string;
  slug: string;
  status: 'draft' | 'published';
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  image: string;
  liveUrl: string;
  editUrl: string;
};

/**
 * The documents in the connected Sanity dataset, read live. The provider
 * answers with the list, or with `{ error }` when Sanity refused - both are
 * surfaced, because an empty screen that could mean either is the one thing
 * worth avoiding.
 */
export const useSanityDocuments = (integrationId?: string) => {
  const customFunc = useCustomProviderFunction();

  const { data, isLoading, mutate } = useSWR<
    SanityDocument[] | { error: string } | false
  >(
    integrationId ? `sanity-documents-${integrationId}` : null,
    () => customFunc.get('documents'),
    {
      revalidateOnFocus: false,
    }
  );

  return {
    documents: Array.isArray(data) ? data : undefined,
    error:
      data && !Array.isArray(data)
        ? (data as { error?: string })?.error ||
          'Could not read documents from Sanity.'
        : undefined,
    isLoading,
    mutate,
  };
};
