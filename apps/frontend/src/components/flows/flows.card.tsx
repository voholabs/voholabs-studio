'use client';

import { FC, memo, RefObject, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Flow } from '@gitroom/frontend/components/flows/flows.hooks';
import {
  MOBILE_MEDIA_QUERY,
  useMediaMatch,
} from '@gitroom/frontend/components/ui/media.match.hook';
import { useWalletAccess } from '@gitroom/frontend/components/wallet-locks/wallet.access';
import {
  findAction,
  useWalletPrices,
} from '@gitroom/frontend/components/wallet/wallet.hooks';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import { RESEARCH_ACTION } from '@gitroom/frontend/components/wallet/wallet.price.list';

type T = ReturnType<typeof useT>;

// The four flow categories, in the order the chips and rails show them.
export const FLOW_CATEGORIES = ['video', 'image', 'writing', 'marketing'];

export const flowCategoryLabel = (t: T, key?: string) => {
  switch (key) {
    case 'video':
      return t('flows_category_video', 'Video');
    case 'image':
      return t('flows_category_image', 'Image');
    case 'writing':
      return t('flows_category_writing', 'Writing');
    case 'marketing':
      return t('flows_category_marketing', 'Marketing');
    default:
      return key || '';
  }
};

export const isNewFlow = (flow: Flow) =>
  !!flow.addedAt &&
  dayjs(flow.addedAt).isValid() &&
  dayjs(flow.addedAt).isAfter(dayjs().subtract(21, 'day'));

// When muted previews may play: never with reduced motion or data saver on.
// Desktop plays the hovered card, phones play what is scrolled into view.
export const usePreviewPolicy = () => {
  const motion = useMediaMatch('(prefers-reduced-motion: no-preference)');
  const pointer = useMediaMatch('(hover: hover) and (pointer: fine)');
  const mobile = useMediaMatch(MOBILE_MEDIA_QUERY);
  const [saveData, setSaveData] = useState(true);
  useEffect(() => {
    setSaveData(
      !!(navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection?.saveData
    );
  }, []);
  const autoplay = motion && !saveData;
  return {
    autoplay,
    hover: autoplay && pointer && !mobile,
    scroll: autoplay && mobile,
  };
};

// Reports whether the element is mostly on screen.
export const useInView = (
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  threshold = 0.75
) => {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!enabled || !ref.current) {
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, enabled, threshold]);
  return inView;
};

// The cost as text. Free for now shows the estimate struck through, with a
// tooltip saying why. On a poster the free mark is a pill so it stays legible.
// The credits part of a cost line ("About 10-15 credits for a short, ...")
// as "~10-15 credits", for the cards and the hero. The drawer shows it all.
export const flowCostEstimate = (cost?: string) => {
  const match = cost?.match(
    /(\d[\d.,]*(?:\s*[-\u2013]\s*\d[\d.,]*)?)\s*credits?\b/i
  );
  return match ? `~${match[1].replace(/\s+/g, '')} credits` : cost;
};

export const FlowCost: FC<{
  flow: Flow;
  overlay?: boolean;
  // only the estimate, not the whole sentence
  short?: boolean;
}> = ({ flow, overlay, short }) => {
  const t = useT();
  const cost = short
    ? flow.costEstimate || flowCostEstimate(flow.cost)
    : flow.cost;
  if (!flow.free) {
    return cost ? <span>{cost}</span> : null;
  }
  const why = t(
    'flows_free_why',
    'We cover the cost while this flow is new. The estimate shows what it will cost later.'
  );
  return (
    <span className="inline-flex items-center gap-[6px] flex-wrap">
      {!!cost && (
        <span
          className={`line-through ${
            overlay ? 'text-white/60' : 'text-textItemBlur'
          }`}
        >
          {cost}
        </span>
      )}
      <span
        data-tooltip-id="tooltip"
        data-tooltip-content={why}
        data-tooltip-class-name="!max-w-[260px] !whitespace-normal !leading-[1.5]"
        className={
          overlay
            ? 'inline-flex items-center h-[18px] px-[6px] rounded-full bg-btnPrimary text-white text-[11px] font-[600]'
            : 'text-tealText font-[600] cursor-help'
        }
      >
        {t('flows_free_now', 'Free for now')}
      </span>
    </span>
  );
};

export const FlowPoster: FC<{ flow: Flow; contain?: boolean }> = ({
  flow,
  contain,
}) =>
  flow.poster ? (
    <img
      src={flow.poster}
      alt=""
      loading="lazy"
      className={`absolute inset-0 w-full h-full ${
        contain ? 'object-contain' : 'object-cover'
      }`}
    />
  ) : (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-newBgLineColor to-newBgColor text-[48px] font-[700] text-newTextColor/25"
    >
      {flow.title.trim().charAt(0).toUpperCase()}
    </div>
  );

export const FlowBadges: FC<{ flow: Flow }> = ({ flow }) => {
  const t = useT();
  return (
    <span className="flex items-center gap-[6px] shrink-0">
      {flow.featured && (
        <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-black/60 border border-white/15 text-white backdrop-blur-[6px]">
          {t('flows_trending', 'Trending')}
        </span>
      )}
      {isNewFlow(flow) && (
        <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-btnPrimary text-white">
          {t('flows_new', 'New')}
        </span>
      )}
    </span>
  );
};

const SlidesGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="1.5"
      y="4"
      width="9"
      height="10.5"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M5 1.5h7.5A2 2 0 0 1 14.5 3.5V11"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

// A sample that is a set of images (a carousel's slides): the card shows its
// cover and how many there are, the drawer swipes through them.
export const FlowSlideCount: FC<{ flow: Flow }> = ({ flow }) => {
  const t = useT();
  const count = flow.exampleImages?.length || 0;
  if (count < 2) {
    return null;
  }
  return (
    <span
      aria-label={t('flows_sample_images', '{{count}} images in the sample', {
        count,
      })}
      className="inline-flex items-center gap-[5px] h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-black/60 border border-white/15 text-white backdrop-blur-[6px]"
    >
      <SlidesGlyph />
      1/{count}
    </span>
  );
};

// The flow's research data is still locked: a free-plan workspace without
// Plus, while the research price row is Plus-only (the row the gateway's
// quote reads). Paid plans and Plus have it open.
export const useResearchLocked = (flow: Flow) => {
  const access = useWalletAccess();
  const { data: prices } = useWalletPrices(access === 'free');
  return (
    !!flow.paidResearch &&
    access === 'free' &&
    !!findAction(prices, RESEARCH_ACTION)?.requiresTopUp
  );
};

// On a card: a lock pill over the poster, in the warm accent every locked
// feature uses. The flow itself still runs, on free web research.
export const FlowResearchLock: FC<{ flow: Flow }> = ({ flow }) => {
  const t = useT();
  const locked = useResearchLocked(flow);
  if (!locked) {
    return null;
  }
  return (
    <span
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'plus_flows_research_locked_why',
        'This flow runs on free web research. Review, social and search data are included with Plus.'
      )}
      data-tooltip-class-name="!max-w-[260px] !whitespace-normal !leading-[1.5]"
      className="self-start inline-flex items-center gap-[5px] h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-black/60 border border-warmRing text-warm backdrop-blur-[6px]"
    >
      <LockIcon size={10} />
      {t('plus_flows_research_locked', 'Research data with Plus')}
    </span>
  );
};

const PlayGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 2.5v11l9-5.5-9-5.5Z" fill="currentColor" />
  </svg>
);

const FlowCardInner: FC<{
  flow: Flow;
  // a key unique on the page: the same flow can sit in a rail and the grid
  playKey: string;
  playing: boolean;
  size?: 'grid' | 'rail' | 'small';
  onOpen: (id: string) => void;
  onHover?: (key: string | null) => void;
  onVisible?: (key: string, visible: boolean) => void;
}> = ({
  flow,
  playKey,
  playing,
  size = 'grid',
  onOpen,
  onHover,
  onVisible,
}) => {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const watch = !!onVisible && !!flow.exampleVideo;
  const inView = useInView(ref, watch);

  useEffect(() => {
    if (!watch) {
      return;
    }
    onVisible?.(playKey, inView);
  }, [watch, inView, playKey, onVisible]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      onVisible?.(playKey, false);
    },
    [playKey, onVisible]
  );

  const enter = () => {
    if (!onHover || !flow.exampleVideo) {
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onHover(playKey), 300);
  };
  const leave = () => {
    clearTimeout(timer.current);
    onHover?.(null);
  };

  const small = size === 'small';
  // The media fills the card behind it; the badges and the text are laid out
  // in a column on top, so a long title pushes the card taller instead of
  // running into the summary. overflow-clip (not hidden) keeps that growth.
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(flow.id)}
      onMouseEnter={enter}
      onMouseLeave={leave}
      aria-label={flow.title}
      className={`group relative isolate flex flex-col text-start overflow-clip bg-newTableHeader border border-newTableBorder hover:border-tealText focus-visible:border-tealText outline-none transition-[border-color,box-shadow] hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)] ${
        small ? 'rounded-[8px] aspect-video w-full' : 'rounded-[12px]'
      } ${
        size === 'grid'
          ? 'w-full aspect-[4/3] min-h-[220px] mobile:aspect-auto mobile:min-h-[230px]'
          : ''
      } ${
        size === 'rail'
          ? 'w-[min(78vw,400px)] shrink-0 snap-start aspect-video min-h-[220px]'
          : ''
      }`}
    >
      <span className="absolute inset-0 -z-10 transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
        <FlowPoster flow={flow} />
        {playing && !!flow.exampleVideo && (
          <video
            className="absolute inset-0 w-full h-full object-cover"
            src={flow.exampleVideo}
            poster={flow.poster}
            muted
            loop
            playsInline
            autoPlay
            preload="none"
          />
        )}
      </span>
      <span className="absolute inset-0 -z-10 bg-gradient-to-t from-black/95 via-black/50 to-black/10 pointer-events-none" />
      {!small && (
        <span className="flex items-start gap-[6px] p-[10px]">
          {!!flow.category && (
            <span className="inline-flex items-center h-[20px] px-[8px] rounded-full text-[11px] font-[600] bg-black/60 border border-white/15 text-white backdrop-blur-[6px]">
              {flowCategoryLabel(t, flow.category)}
            </span>
          )}
          <span className="flex-1" />
          <FlowSlideCount flow={flow} />
          <FlowBadges flow={flow} />
        </span>
      )}
      <span className="flex-1 min-h-[12px] flex items-center justify-center">
        {!small && (
          <span className="inline-flex items-center h-[34px] px-[16px] rounded-full bg-btnPrimary text-white text-[13px] font-[600] shadow-lg opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity mobile:hidden pointer-events-none">
            {t('flows_make_this', 'Make this')}
          </span>
        )}
      </span>
      <span
        className={`relative flex flex-col ${
          small ? 'p-[8px] gap-[2px]' : 'p-[12px] pt-0 gap-[6px]'
        }`}
      >
        {/* A near-solid scrim behind the text, fading in just above it, so
            text or charts in a light or busy poster never show through. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-black/90 pointer-events-none"
        />
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-full h-[40px] -z-10 bg-gradient-to-t from-black/90 to-transparent pointer-events-none"
        />
        <span
          className={`text-white font-[700] leading-[1.25] tracking-[-0.01em] line-clamp-2 ${
            small ? 'text-[12px]' : 'text-[15px] mobile:text-[14px]'
          }`}
        >
          {flow.title}
        </span>
        {!small && (
          <span className="text-[13px] mobile:text-[12px] text-white/70 leading-[1.4] line-clamp-2">
            {flow.summary}
          </span>
        )}
        {!small && <FlowResearchLock flow={flow} />}
        <span
          className={`flex items-center gap-[8px] text-white/85 ${
            small ? 'text-[11px]' : 'text-[12px]'
          }`}
        >
          <span className="flex-1 min-w-0">
            <FlowCost flow={flow} overlay={true} short={true} />
          </span>
          {!!flow.exampleVideo && !small && (
            <span className="shrink-0 text-white/80">
              <PlayGlyph />
            </span>
          )}
        </span>
      </span>
    </button>
  );
};

export const FlowCard = memo(FlowCardInner);
