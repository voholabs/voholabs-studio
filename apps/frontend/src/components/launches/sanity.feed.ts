'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

const MARKER = /sanity:([^\s<"]+)/;

export const sanityDocumentIdOf = (content?: string) =>
  (content || '').match(MARKER)?.[1];

/**
 * A blog post exists in Sanity long before anyone schedules it, so unlike every
 * other channel there is nothing in our database to list. These are folded into
 * the same feed as real posts so a blog post reads like any other post, rather
 * than living in a drawer of its own.
 *
 * Anything already scheduled is dropped - that one is a real post and is
 * already in the feed on its own terms.
 */
export const useSanityFeedItems = (
  integrations: Integrations[],
  listPosts: any[],
  listState: string,
  listReviewed: string = 'all'
) => {
  const fetch = useFetch();

  const sanityIntegrations = useMemo(
    () => integrations.filter((i) => i.identifier === 'sanity' && !i.disabled),
    [integrations]
  );

  const key = sanityIntegrations
    .map((i) => i.id)
    .sort()
    .join(',');

  const { data } = useSWR(
    key ? `sanity-feed-${key}` : null,
    async () => {
      const perChannel = await Promise.all(
        sanityIntegrations.map(async (integration) => {
          const response = await fetch('/integrations/function', {
            method: 'POST',
            body: JSON.stringify({
              name: 'documents',
              id: integration.id,
              data: {},
            }),
          });

          const documents = await response.json();

          return Array.isArray(documents)
            ? documents.map((document: any) => ({ document, integration }))
            : [];
        })
      );

      return perChannel.flat();
    },
    { revalidateOnFocus: false }
  );

  return useMemo(() => {
    if (!data?.length) {
      return [];
    }

    const alreadyScheduled = new Set(
      (listPosts || [])
        .map((post: any) => sanityDocumentIdOf(post?.content))
        .filter(Boolean)
    );

    return data
      .filter(({ document }) => !alreadyScheduled.has(document.id))
      // These rows exist only in Sanity, so there is nothing of ours to carry a
      // reviewed mark - they are all unreviewed by construction.
      .filter(() => listReviewed !== 'reviewed')
      .filter(({ document }) => {
        // "Scheduled" means we hold a publish time for it, which by definition
        // none of these have.
        if (listState === 'scheduled') return false;
        if (listState === 'draft') return document.status === 'draft';
        if (listState === 'published') return document.status === 'published';
        return true;
      })
      .map(({ document, integration }) => ({
        id: `sanity-${integration.id}-${document.id}`,
        group: '',
        content: `sanity:${document.id}`,
        // Nothing is scheduled, so the only honest date is when it last changed.
        publishDate: document.updatedAt || new Date().toISOString(),
        state: document.status === 'published' ? 'PUBLISHED' : 'DRAFT',
        releaseURL: '',
        reviewed: false,
        tags: [],
        integration: {
          id: integration.id,
          providerIdentifier: 'sanity',
          name: integration.name,
          picture: integration.picture,
        },
        // Marks the row as "in Sanity, not scheduled here".
        sanityDocument: document,
      }));
  }, [data, listPosts, listState, listReviewed]);
};
