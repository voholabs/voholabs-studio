'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { InfoIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import { ChevronIcon } from '@gitroom/frontend/components/wallet/wallet.ui';
import { Flow, useFlows } from '@gitroom/frontend/components/flows/flows.hooks';
import {
  FLOW_CATEGORIES,
  FlowBadges,
  FlowCard,
  FlowCost,
  FlowPoster,
  FlowResearchLock,
  flowCategoryLabel,
  useInView,
  usePreviewPolicy,
} from '@gitroom/frontend/components/flows/flows.card';
import { FlowDrawer } from '@gitroom/frontend/components/flows/flows.drawer';

// Flows are packaged marketing jobs the user's own agent runs through Studio's
// MCP. This page shows what each one makes, with a sample and its cost, and
// hands over the prompt to paste into the agent: the work happens there.

type Sort = 'featured' | 'newest' | 'az';

const addedTime = (flow: Flow) => {
  const time = flow.addedAt ? new Date(flow.addedAt).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

// Featured first, then the newest.
const sortFlows = (flows: Flow[], sort: Sort) =>
  [...flows].sort((a, b) => {
    if (sort === 'az') {
      return a.title.localeCompare(b.title);
    }
    if (sort === 'newest') {
      return addedTime(b) - addedTime(a);
    }
    return (
      Number(!!b.featured) - Number(!!a.featured) ||
      addedTime(b) - addedTime(a)
    );
  });

// Rails and the hero only show while browsing, and rails only once the
// catalog is big enough that they don't repeat the grid.
const RAIL_MIN_FLOWS = 8;
const RAIL_SIZE = 12;
const SORT_MIN_FLOWS = 24;

const SearchIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    className="text-textItemBlur shrink-0"
  >
    <path
      d="M14 14L10.5 10.5M12 7.33333C12 9.91066 9.91066 12 7.33333 12C4.75601 12 2.66667 9.91066 2.66667 7.33333C2.66667 4.75601 4.75601 2.66667 7.33333 2.66667C9.91066 2.66667 12 4.75601 12 7.33333Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const FlowHero: FC<{
  flow: Flow;
  autoplay: boolean;
  onOpen: (id: string) => void;
  onInView: (inView: boolean) => void;
}> = ({ flow, autoplay, onOpen, onInView }) => {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, autoplay, 0.5);
  useEffect(() => {
    onInView(inView);
  }, [inView, onInView]);
  useEffect(() => () => onInView(false), [onInView]);

  // Text on solid black at the start, the example whole (contained, never
  // cropped) at the end: a light video would wash out text laid over it.
  // Phones stack the video above the text.
  return (
    <div
      ref={ref}
      className="relative w-full flex items-stretch mobile:flex-col-reverse rounded-[16px] overflow-hidden bg-black shrink-0"
    >
      <div className="relative z-[1] flex-1 min-w-0 flex flex-col justify-end gap-[10px] p-[32px] mobile:p-[18px]">
        <div className="flex items-center gap-[6px] flex-wrap">
          {!!flow.category && (
            <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-white/10 text-white/85">
              {flowCategoryLabel(t, flow.category)}
            </span>
          )}
          <FlowBadges flow={flow} />
        </div>
        <button
          type="button"
          onClick={() => onOpen(flow.id)}
          className="text-start text-[34px] tablet:text-[28px] mobile:text-[24px] font-[700] leading-[1.1] text-white line-clamp-3 hover:underline decoration-2 underline-offset-4"
        >
          {flow.title}
        </button>
        <div className="text-[15px] mobile:text-[13px] text-white/75 leading-[1.5] line-clamp-3">
          {flow.summary}
        </div>
        <FlowResearchLock flow={flow} />
        <div className="flex items-center gap-[14px] flex-wrap mt-[4px]">
          <button
            type="button"
            onClick={() => onOpen(flow.id)}
            className="h-[42px] px-[22px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[15px] font-[600] transition-all"
          >
            {t('flows_make_this', 'Make this')}
          </button>
          <span className="text-[13px] text-white/85">
            <FlowCost flow={flow} overlay={true} short={true} />
          </span>
        </div>
      </div>
      <div className="relative w-[60%] mobile:w-full aspect-video max-h-[min(60vh,560px)] shrink-0">
        <FlowPoster flow={flow} contain={true} />
        {autoplay && inView && !!flow.exampleVideo && (
          <video
            className="absolute inset-0 w-full h-full object-contain"
            src={flow.exampleVideo}
            poster={flow.poster}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
          />
        )}
        <div className="absolute inset-y-0 start-0 w-[48px] bg-gradient-to-r from-black to-transparent pointer-events-none mobile:hidden" />
      </div>
    </div>
  );
};

const FlowRail: FC<{
  title: string;
  flows: Flow[];
  railKey: string;
  playing: (key: string) => boolean;
  onOpen: (id: string) => void;
  onHover?: (key: string | null) => void;
  onVisible?: (key: string, visible: boolean) => void;
  onSeeAll?: () => void;
}> = ({
  title,
  flows,
  railKey,
  playing,
  onOpen,
  onHover,
  onVisible,
  onSeeAll,
}) => {
  const t = useT();
  return (
    <section className="flex flex-col gap-[10px] min-w-0">
      <div className="flex items-center gap-[12px]">
        <h2 className="flex-1 text-[18px] font-[700]">{title}</h2>
        {!!onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-[13px] font-[600] text-tealText hover:underline"
          >
            {t('flows_see_all', 'See all')}
          </button>
        )}
      </div>
      <div className="flex gap-[12px] overflow-x-auto snap-x snap-mandatory pb-[6px] -mx-[20px] px-[20px] scroll-px-[20px]">
        {flows.map((flow) => {
          const key = `${railKey}:${flow.id}`;
          return (
            <FlowCard
              key={flow.id}
              flow={flow}
              playKey={key}
              playing={playing(key)}
              size="rail"
              onOpen={onOpen}
              onHover={onHover}
              onVisible={onVisible}
            />
          );
        })}
      </div>
    </section>
  );
};

const FlowFilterBar: FC<{
  categories: string[];
  category: string;
  onCategory: (category: string) => void;
  query: string;
  onQuery: (query: string) => void;
  sort?: Sort;
  onSort?: (sort: Sort) => void;
}> = ({ categories, category, onCategory, query, onQuery, sort, onSort }) => {
  const t = useT();
  const chips = [
    { key: '', label: t('flows_all', 'All') },
    ...categories.map((one) => ({
      key: one,
      label: flowCategoryLabel(t, one),
    })),
  ];
  return (
    <div className="flex items-center gap-[12px] flex-wrap mobile:flex-col mobile:items-stretch">
      <div
        className="flex items-center gap-[6px] flex-wrap flex-1 min-w-[260px] mobile:min-w-0 mobile:flex-nowrap mobile:overflow-x-auto mobile:-mx-[20px] mobile:px-[20px] mobile:pb-[2px]"
        role="tablist"
        aria-label={t('flows_filter', 'Filter flows')}
      >
        {chips.map((chip) => {
          const active = category === chip.key;
          return (
            <button
              key={chip.key || 'all'}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onCategory(chip.key)}
              className={`h-[32px] px-[12px] shrink-0 rounded-[8px] text-[13px] font-[500] transition-colors border ${
                active
                  ? 'bg-tealSoft text-tealText border-tealText'
                  : 'border-newTableBorder text-textItemBlur hover:text-newTextColor hover:border-tealText'
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-[8px] mobile:order-first">
        {!!sort && !!onSort && (
          <span className="relative inline-flex mobile:hidden">
            <select
              aria-label={t('flows_sort', 'Sort flows')}
              value={sort}
              onChange={(event) => onSort(event.target.value as Sort)}
              className="appearance-none h-[38px] ps-[12px] pe-[28px] bg-newBgColorInner border border-newTableBorder rounded-[8px] text-[14px] hover:border-newSep cursor-pointer outline-none"
            >
              <option value="featured">
                {t('flows_sort_featured', 'Featured')}
              </option>
              <option value="newest">{t('flows_sort_newest', 'Newest')}</option>
              <option value="az">{t('flows_sort_az', 'A–Z')}</option>
            </select>
            <span className="pointer-events-none absolute end-[10px] top-1/2 -translate-y-1/2 text-textItemBlur">
              <ChevronIcon />
            </span>
          </span>
        )}
        <div className="flex items-center gap-[8px] h-[38px] w-[320px] mobile:w-full px-[12px] rounded-[8px] border border-newTableBorder focus-within:border-tealText transition-colors">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t('flows_search', 'Search flows...')}
            aria-label={t('flows_search_label', 'Search flows')}
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] placeholder:text-textItemBlur"
          />
        </div>
      </div>
    </div>
  );
};

export const FlowsPage: FC = () => {
  const t = useT();
  const { data, isLoading, error } = useFlows();
  const pathname = usePathname();
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('featured');
  const gridRef = useRef<HTMLDivElement>(null);

  // The open flow lives in the URL (/flows/<id>) so it can be shared.
  const open = useMemo(() => {
    const match = pathname?.match(/^\/flows\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
  const openFlow = useCallback((id: string) => {
    window.history.pushState(null, '', `/flows/${encodeURIComponent(id)}`);
  }, []);
  const close = useCallback(() => {
    window.history.pushState(null, '', '/flows');
  }, []);

  // Search once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Muted previews: the hovered card on desktop; on phones the first cards
  // scrolled into view, at most two at once counting the hero.
  const policy = usePreviewPolicy();
  const [hovered, setHovered] = useState<string | null>(null);
  const [visible, setVisible] = useState<string[]>([]);
  const [heroInView, setHeroInView] = useState(false);
  const onVisible = useCallback((key: string, inView: boolean) => {
    setVisible((list) =>
      inView
        ? list.includes(key)
          ? list
          : [...list, key]
        : list.includes(key)
        ? list.filter((one) => one !== key)
        : list
    );
  }, []);
  const playingOnScroll = useMemo(
    () => new Set(visible.slice(0, heroInView && policy.autoplay ? 1 : 2)),
    [visible, heroInView, policy.autoplay]
  );
  const playing = useCallback(
    (key: string) =>
      policy.hover
        ? hovered === key
        : policy.scroll
        ? playingOnScroll.has(key)
        : false,
    [policy.hover, policy.scroll, hovered, playingOnScroll]
  );
  const cardHover = policy.hover ? setHovered : undefined;
  const cardVisible = policy.scroll ? onVisible : undefined;

  const flows = useMemo(() => sortFlows(data || [], 'featured'), [data]);
  const categories = useMemo(
    () =>
      FLOW_CATEGORIES.filter((key) =>
        flows.some((flow) => flow.category === key)
      ),
    [flows]
  );

  // A category that no flow uses any more drops back to All.
  useEffect(() => {
    if (category && !categories.includes(category)) {
      setCategory('');
    }
  }, [category, categories]);

  const filtered = useMemo(() => {
    const list = flows.filter((flow) => {
      if (category && flow.category !== category) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [
        flow.title,
        flow.summary,
        flowCategoryLabel(t, flow.category),
        ...(flow.tags || []),
      ].some((text) => !!text && text.toLowerCase().includes(search));
    });
    return sort === 'featured' ? list : sortFlows(list, sort);
  }, [flows, category, search, sort, t]);

  const browsing = !category && !search;
  const hero = useMemo(
    () =>
      flows.find((flow) => flow.featured && flow.exampleVideo) ||
      flows.find((flow) => flow.featured) ||
      flows.find((flow) => flow.exampleVideo),
    [flows]
  );
  const featured = useMemo(
    () => flows.filter((flow) => flow.featured && flow.id !== hero?.id),
    [flows, hero]
  );
  const showRails = browsing && flows.length > RAIL_MIN_FLOWS;

  const selected = open ? flows.find((flow) => flow.id === open) : undefined;
  const related = useMemo(
    () =>
      selected?.category
        ? flows
            .filter(
              (flow) =>
                flow.category === selected.category && flow.id !== selected.id
            )
            .slice(0, 3)
        : [],
    [flows, selected]
  );

  const clearFilters = useCallback(() => {
    setCategory('');
    setQuery('');
    setSearch('');
  }, []);
  const seeAll = useCallback((key: string) => {
    setCategory(key);
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (isLoading && !data) {
    return <LoadingComponent />;
  }

  const more = t(
    'flows_intro_more',
    "Your agent does the work in the chat through Studio's MCP: it asks you a few questions, makes the output, and schedules it. Credits are taken from your wallet only when a flow says so."
  );

  return (
    <>
      <div className="bg-newBgColorInner flex-1 relative min-w-0">
        <div className="absolute inset-0 overflow-y-auto overflow-x-hidden p-[20px] flex flex-col gap-[28px]">
          <div className="inline-flex items-center gap-[6px] text-[14px] text-textItemBlur">
            <span>
              {t(
                'flows_intro',
                'Marketing jobs your agent runs for you. Pick one, copy the prompt, paste it into Claude Cowork or ChatGPT Work.'
              )}
            </span>
            <span
              tabIndex={0}
              role="img"
              aria-label={more}
              data-tooltip-id="tooltip"
              data-tooltip-content={more}
              data-tooltip-class-name="!max-w-[280px] !whitespace-normal !leading-[1.5]"
              className="shrink-0 cursor-help text-textItemBlur hover:text-newTextColor"
            >
              <InfoIcon />
            </span>
          </div>
          {error || !flows.length ? (
            <div className="text-[14px] text-textItemBlur py-[40px] text-center">
              {t('flows_none', 'No flows yet. New ones land here first.')}
            </div>
          ) : (
            <>
              {browsing && !!hero && (
                <FlowHero
                  flow={hero}
                  autoplay={policy.autoplay}
                  onOpen={openFlow}
                  onInView={setHeroInView}
                />
              )}
              {browsing && featured.length > 0 && (
                <FlowRail
                  title={t('flows_featured', 'Featured')}
                  railKey="featured"
                  flows={featured}
                  playing={playing}
                  onOpen={openFlow}
                  onHover={cardHover}
                  onVisible={cardVisible}
                />
              )}
              {showRails &&
                categories.map((key) => (
                  <FlowRail
                    key={key}
                    title={flowCategoryLabel(t, key)}
                    railKey={key}
                    flows={flows
                      .filter((flow) => flow.category === key)
                      .slice(0, RAIL_SIZE)}
                    playing={playing}
                    onOpen={openFlow}
                    onHover={cardHover}
                    onVisible={cardVisible}
                    onSeeAll={() => seeAll(key)}
                  />
                ))}
              <section
                ref={gridRef}
                className="flex flex-col gap-[14px] scroll-mt-[20px]"
              >
                {browsing && (!!hero || featured.length > 0) && (
                  <h2 className="text-[18px] font-[700]">
                    {t('flows_all_flows', 'All flows')}
                  </h2>
                )}
                <FlowFilterBar
                  categories={categories}
                  category={category}
                  onCategory={setCategory}
                  query={query}
                  onQuery={setQuery}
                  sort={flows.length > SORT_MIN_FLOWS ? sort : undefined}
                  onSort={setSort}
                />
                {!filtered.length ? (
                  <div className="flex flex-col items-center gap-[10px] py-[40px] text-[14px] text-textItemBlur text-center">
                    <div>
                      {search
                        ? `${t(
                            'flows_no_match_query',
                            'No flows match'
                          )} "${query.trim()}".`
                        : t('flows_no_match', 'No flows match.')}
                    </div>
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="h-[32px] px-[12px] rounded-[8px] text-[13px] font-[500] border border-newTableBorder text-newTextColor hover:border-tealText"
                    >
                      {t('flows_clear_filters', 'Clear filters')}
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))] mobile:[grid-template-columns:repeat(auto-fill,minmax(min(100%,172px),1fr))]">
                    {filtered.map((flow) => {
                      const key = `grid:${flow.id}`;
                      return (
                        <FlowCard
                          key={flow.id}
                          flow={flow}
                          playKey={key}
                          playing={playing(key)}
                          onOpen={openFlow}
                          onHover={cardHover}
                          onVisible={cardVisible}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      {!!selected && (
        <FlowDrawer
          key={selected.id}
          flow={selected}
          related={related}
          onClose={close}
          onOpen={openFlow}
        />
      )}
    </>
  );
};
