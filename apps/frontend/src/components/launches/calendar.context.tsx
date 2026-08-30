'use client';

import 'reflect-metadata';
import {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Post, Integration, Tags } from '@prisma/client';
import { useSearchParams } from 'next/navigation';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { extend } from 'dayjs';
import useCookie from 'react-use-cookie';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { timer } from '@gitroom/helpers/utils/timer';
import { expandPostsList, expandPosts } from '@gitroom/helpers/utils/posts.list.minify';
import { useSanityFeedItems } from '@gitroom/frontend/components/launches/sanity.feed';
extend(isoWeek);
extend(weekOfYear);

export type ListStateFilter = 'all' | 'scheduled' | 'draft' | 'published';

export type ListReviewedFilter = 'all' | 'reviewed' | 'unreviewed';

export type CalendarDisplay = 'week' | 'month' | 'day' | 'list' | 'review';

/**
 * List and review share the same paginated feed. Review renders a full post
 * preview per row and fetches each post's group on top of that, so it asks for
 * a much smaller page.
 */
export const isFeedDisplay = (display: string) =>
  display === 'list' || display === 'review';

const feedPageSize = (display: string) => (display === 'review' ? 25 : 100);

export const CalendarContext = createContext({
  startDate: newDayjs().startOf('isoWeek').format('YYYY-MM-DD'),
  endDate: newDayjs().endOf('isoWeek').format('YYYY-MM-DD'),
  customer: null as string | null,
  loading: true,
  sets: [] as { name: string; id: string; content: string[] }[],
  signature: undefined as any,
  comments: [] as Array<{
    date: string;
    total: number;
  }>,
  integrations: [] as (Integrations & {
    refreshNeeded?: boolean;
  })[],
  trendings: [] as string[],
  posts: [] as Array<
    Post & {
      integration: Integration;
      tags: {
        tag: Tags;
      }[];
    }
  >,
  reloadCalendarView: () => {
    /** empty **/
  },
  display: 'week',
  setFilters: (filters: {
    startDate: string;
    endDate: string;
    display: CalendarDisplay;
    customer: string | null;
  }) => {
    /** empty **/
  },
  changeDate: (id: string, date: dayjs.Dayjs) => {
    /** empty **/
  },
  // List view specific
  listPosts: [] as Array<
    Post & {
      integration: Integration;
      tags: {
        tag: Tags;
      }[];
    }
  >,
  listPage: 0,
  listTotalPages: 0,
  setListPage: (page: number) => {
    /** empty **/
  },
  listState: 'all' as ListStateFilter,
  setListState: (state: ListStateFilter) => {
    /** empty **/
  },
  // Narrows the feed to a single channel. Null is "every channel".
  listIntegration: null as string | null,
  setListIntegration: (id: string | null) => {
    /** empty **/
  },
  // Posts per integration id across the whole feed, not just the current page.
  listCounts: {} as Record<string, number>,
  // The same, ignoring the review state - which channels get a chip at all.
  listChannelCounts: {} as Record<string, number>,
  listReviewed: 'all' as ListReviewedFilter,
  setListReviewed: (reviewed: ListReviewedFilter) => {
    /** empty **/
  },
});

export interface Integrations {
  name: string;
  id: string;
  disabled?: boolean;
  inBetweenSteps: boolean;
  editor: 'none' | 'normal' | 'markdown' | 'html';
  stripLinks?: boolean;
  display: string;
  identifier: string;
  type: string;
  picture: string;
  changeProfilePicture: boolean;
  additionalSettings: string;
  changeNickName: boolean;
  time: {
    time: number;
  }[];
  customer?: {
    name?: string;
    id?: string;
  };
}

// Helper function to get start and end dates based on display type
function getDateRange(display: string, referenceDate?: string) {
  const date = referenceDate ? newDayjs(referenceDate) : newDayjs();

  switch (display) {
    case 'day':
      return {
        startDate: date.format('YYYY-MM-DD'),
        endDate: date.format('YYYY-MM-DD'),
      };
    case 'week':
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
    case 'month':
      return {
        startDate: date.startOf('month').format('YYYY-MM-DD'),
        endDate: date.endOf('month').format('YYYY-MM-DD'),
      };
    default:
      return {
        startDate: date.startOf('isoWeek').format('YYYY-MM-DD'),
        endDate: date.endOf('isoWeek').format('YYYY-MM-DD'),
      };
  }
}

export const CalendarWeekProvider: FC<{
  children: ReactNode;
  integrations: Integrations[];
}> = ({ children, integrations }) => {
  const fetch = useFetch();
  const [internalData, setInternalData] = useState([] as any[]);
  const [trendings] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const [displaySaved, setDisplaySaved] = useCookie('calendar-display', 'week');
  const display = searchParams.get('display') || displaySaved;

  // List view state
  const [listPage, setListPage] = useState(0);
  const [listState, setListStateRaw] = useState<ListStateFilter>('all');
  const setListState = useCallback((next: ListStateFilter) => {
    setListStateRaw(next);
    setListPage(0);
  }, []);
  const [listReviewed, setListReviewedRaw] =
    useState<ListReviewedFilter>('all');
  const setListReviewed = useCallback((next: ListReviewedFilter) => {
    setListReviewedRaw(next);
    setListPage(0);
  }, []);

  // The channel filter is a server-side one: a feed is paginated, so filtering
  // the page we happen to hold would quietly hide the rest of that channel's
  // posts and leave the pager counting pages that no longer exist.
  const [listIntegration, setListIntegrationRaw] = useState<string | null>(null);
  const setListIntegration = useCallback((next: string | null) => {
    setListIntegrationRaw(next);
    setListPage(0);
  }, []);

  // Initialize with current date range based on URL params or defaults
  const initStartDate = searchParams.get('startDate');
  const initEndDate = searchParams.get('endDate');
  const initCustomer = searchParams.get('customer');

  const initialRange =
    initStartDate && initEndDate
      ? { startDate: initStartDate, endDate: initEndDate }
      : getDateRange(display);

  const [filters, setFilters] = useState({
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    customer: initCustomer || null,
    display,
  });

  const params = useMemo(() => {
    return new URLSearchParams({
      display: filters.display,
      startDate: filters.startDate,
      endDate: filters.endDate,
      customer: filters?.customer?.toString() || '',
    }).toString();
  }, [filters]);

  // Calendar view data fetcher
  const loadData = useCallback(async () => {
    const modifiedParams = new URLSearchParams({
      display: filters.display,
      customer: filters?.customer?.toString() || '',
      startDate: newDayjs(filters.startDate).startOf('day').utc().format(),
      endDate: newDayjs(filters.endDate).endOf('day').utc().format(),
    }).toString();

    const data = await (await fetch(`/posts?${modifiedParams}`)).json();
    return expandPosts(data);
  }, [filters, params]);

  // List view data fetcher
  const listLimit = feedPageSize(filters.display);
  const listParams = useMemo(() => {
    return new URLSearchParams({
      page: listPage.toString(),
      limit: listLimit.toString(),
      customer: filters?.customer?.toString() || '',
      state: listState,
      ...(listIntegration ? { integration: listIntegration } : {}),
      // Only review shows the mark on every row and offers the pills, so the
      // list view must not inherit a filter it gives you no way to see or undo.
      reviewed: filters.display === 'review' ? listReviewed : 'all',
    }).toString();
  }, [
    listPage,
    listLimit,
    filters.customer,
    filters.display,
    listState,
    listIntegration,
    listReviewed,
  ]);

  const loadListData = useCallback(async () => {
    const response = await fetch(`/posts/list?${listParams}`);
    return expandPostsList(await response.json());
  }, [listParams]);

  // SWR for calendar view
  const {
    data: calendarData,
    isLoading: calendarIsLoading,
    mutate: mutateCalendar,
  } = useSWR(
    !isFeedDisplay(filters.display) ? `/posts-${params}` : null,
    loadData,
    {
      refreshInterval: 3600000,
      refreshWhenOffline: false,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    }
  );

  // SWR for list view
  const {
    data: listData,
    isLoading: listIsLoading,
    mutate: mutateList,
  } = useSWR(
    isFeedDisplay(filters.display) ? `/posts-list-${listParams}` : null,
    loadListData,
    {
      refreshInterval: 3600000,
      refreshWhenOffline: false,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    }
  );

  const defaultSign = useCallback(async () => {
    return await (await fetch('/signatures/default')).json();
  }, []);

  const setList = useCallback(async () => {
    return (await fetch('/sets')).json();
  }, []);

  const { data: sets, mutate } = useSWR('sets', setList, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const { data: sign } = useSWR('default-sign', defaultSign, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

  const setFiltersWrapper = useCallback(
    (newFilters: {
      startDate: string;
      endDate: string;
      display: CalendarDisplay;
      customer: string | null;
    }) => {
      setDisplaySaved(newFilters.display);
      setFilters(newFilters);
      setInternalData([]);

      // Reset page when switching into a feed view
      if (isFeedDisplay(newFilters.display)) {
        setListPage(0);
      }

      const path = [
        `startDate=${newFilters.startDate}`,
        `endDate=${newFilters.endDate}`,
        `display=${newFilters.display}`,
        newFilters.customer ? `customer=${newFilters.customer}` : ``,
      ].filter((f) => f);
      window.history.replaceState(null, '', `/launches?${path.join('&')}`);
    },
    []
  );

  const posts = useMemo(() => calendarData?.posts || [], [calendarData?.posts]);
  const comments = useMemo(() => calendarData?.comments || [], [calendarData?.comments]);

  // List view data
  const realListPosts = useMemo(() => listData?.posts || [], [listData?.posts]);

  // Blog posts that exist in Sanity but are not scheduled yet have no row of
  // their own, so they are merged in here - once, at the source - and every
  // feed that reads listPosts shows them alongside real posts.
  const allSanityItems = useSanityFeedItems(
    integrations,
    realListPosts,
    listState
  );

  // These rows exist only in Sanity, so there is nothing of ours to carry a
  // reviewed mark - they are all unreviewed by construction. "Reviewed" drops
  // them rather than letting them claim a mark they cannot have.
  const sanityItems = useMemo(
    () =>
      filters.display === 'review' && listReviewed === 'reviewed'
        ? []
        : allSanityItems,
    [allSanityItems, filters.display, listReviewed]
  );

  const listPosts = useMemo(
    () =>
      [
        ...realListPosts,
        // Sanity items never went through the query, so the channel filter has
        // to be applied to them here.
        ...(listIntegration
          ? sanityItems.filter((i) => i.integration?.id === listIntegration)
          : sanityItems),
      ].sort((a, b) =>
        listState === 'published'
          ? String(b.publishDate).localeCompare(String(a.publishDate))
          : String(a.publishDate).localeCompare(String(b.publishDate))
      ),
    [realListPosts, sanityItems, listState, listIntegration]
  );

  // The server counts rows it holds; unscheduled Sanity documents only exist in
  // the merged feed, so their channels are counted on top of it.
  const listCounts = useMemo(() => {
    const counts: Record<string, number> = { ...(listData?.counts || {}) };
    for (const item of sanityItems) {
      const id = item.integration?.id;
      if (id) {
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    return counts;
  }, [listData?.counts, sanityItems]);

  // Which channels get a chip. Sanity rows carry no mark of ours, so they are
  // counted here whatever the review filter says - the same reason they are
  // dropped from "Reviewed" rather than claiming one.
  const listChannelCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ...(listData?.channelCounts || listData?.counts || {}),
    };
    for (const item of allSanityItems) {
      const id = item.integration?.id;
      if (id) {
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    return counts;
  }, [listData?.channelCounts, listData?.counts, allSanityItems]);
  const listTotal = listData?.total || 0;
  const listTotalPages = Math.ceil(listTotal / listLimit);

  const changeDate = useCallback(
    (id: string, date: dayjs.Dayjs) => {
      setInternalData((d) =>
        d.map((post: Post) => {
          if (post.id === id) {
            return {
              ...post,
              publishDate: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
            };
          }
          return post;
        })
      );
    },
    [posts, internalData]
  );

  useEffect(() => {
    if (posts) {
      setInternalData(posts);
    }
  }, [posts]);

  // Combined reload function that handles both calendar and list views
  const reloadCalendarView = useCallback(() => {
    mutateCalendar();
    mutateList();
  }, [mutateCalendar, mutateList]);

  // Determine loading state based on current view
  const loading = isFeedDisplay(filters.display)
    ? listIsLoading
    : calendarIsLoading;

  return (
    <CalendarContext.Provider
      value={{
        trendings,
        reloadCalendarView,
        ...filters,
        posts: calendarIsLoading ? [] : internalData,
        loading,
        integrations,
        setFilters: setFiltersWrapper,
        changeDate,
        comments,
        sets: sets || [],
        signature: sign,
        // List view specific
        listPosts,
        listPage,
        listTotalPages,
        setListPage,
        listState,
        setListState,
        listIntegration,
        setListIntegration,
        listCounts,
        listChannelCounts,
        listReviewed,
        setListReviewed,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
};

export const useCalendar = () => useContext(CalendarContext);
