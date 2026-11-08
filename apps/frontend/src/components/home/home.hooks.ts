'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';

// A scheduled post as GET /posts/list returns it (expanded).
export interface UpcomingPost {
  id: string;
  content: string;
  publishDate: string;
  group: string;
  integration: {
    id: string;
    providerIdentifier: string;
    name: string;
    picture: string | null;
  };
}

export interface UpcomingPosts {
  posts: UpcomingPost[];
  total: number;
}

// The next few scheduled posts. "scheduled" is queued posts from now on,
// soonest first, without repeating posts or the parts of a thread.
export const useUpcomingPosts = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(
      `/posts/list?${new URLSearchParams({
        state: 'scheduled',
        limit: '3',
        page: '0',
      }).toString()}`
    );
    if (!response.ok) {
      throw new Error('upcoming-posts');
    }
    return expandPostsList(await response.json()) as UpcomingPosts;
  }, [fetch]);
  return useSWR<UpcomingPosts>('home-upcoming-posts', load);
};
