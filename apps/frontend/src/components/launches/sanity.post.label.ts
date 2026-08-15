'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

/**
 * A Sanity post carries a reference to its document, not the article - the
 * article never leaves Sanity. Anywhere a post is listed next to posts from
 * other channels, that reference has to be resolved to the document's real
 * title, live, or a blog post reads as gibberish beside an X post.
 *
 * Keyed per channel and shared with the rest of the app's document lookups, so
 * a calendar full of blog posts still costs one request.
 */
const MARKER = /sanity:([^\s<"]+)/;

const useSanityDocumentsFor = (integrationId?: string) => {
  const fetch = useFetch();

  return useSWR(
    integrationId ? `sanity-documents-${integrationId}` : null,
    async () => {
      const response = await fetch('/integrations/function', {
        method: 'POST',
        body: JSON.stringify({
          name: 'documents',
          id: integrationId,
          data: {},
        }),
      });

      return response.json();
    },
    { revalidateOnFocus: false }
  );
};

type SanityPostLike = {
  content?: string;
  integration?: {
    id?: string;
    providerIdentifier?: string;
    identifier?: string;
  };
};

/**
 * The live Sanity document behind a post, whether that post is scheduled here
 * or is a document that has not been scheduled at all. Everything a surface
 * needs to show it - title, status, where to read it, where to edit it.
 */
export const useSanityDocumentFor = (post: SanityPostLike) => {
  const identifier =
    post?.integration?.providerIdentifier || post?.integration?.identifier;
  const documentId =
    identifier === 'sanity'
      ? (post?.content || '').match(MARKER)?.[1]
      : undefined;

  const { data, mutate } = useSanityDocumentsFor(
    documentId ? post?.integration?.id : undefined
  );

  const document = Array.isArray(data)
    ? data.find((d: any) => d.id === documentId)
    : undefined;

  /**
   * The document, fetching it first if the list has not arrived yet. A click
   * can land before the lookup does, and falling back to the wrong destination
   * because of a race is worse than waiting a moment for the right one.
   */
  const resolve = useCallback(async () => {
    if (document) {
      return document;
    }

    const fresh = await mutate();
    return Array.isArray(fresh)
      ? fresh.find((d: any) => d.id === documentId)
      : undefined;
  }, [document, mutate, documentId]);

  if (!documentId) {
    return undefined;
  }

  return { documentId, document, resolve };
};

export const useSanityPostLabel = (post: SanityPostLike) => {
  const found = useSanityDocumentFor(post);

  if (!found) {
    return undefined;
  }

  // Until the lookup lands - or if the document has since been deleted - say
  // what it is rather than showing the raw reference.
  return found.document?.title || 'Blog post';
};
