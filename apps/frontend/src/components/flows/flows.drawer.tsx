'use client';

import {
  FC,
  ReactNode,
  TouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { BottomSheet } from '@gitroom/frontend/components/ui/bottom.sheet.component';
import { Flow } from '@gitroom/frontend/components/flows/flows.hooks';
import {
  FlowCard,
  FlowCost,
  FlowPoster,
  flowCategoryLabel,
  useResearchLocked,
} from '@gitroom/frontend/components/flows/flows.card';
import { openPlus } from '@gitroom/frontend/components/wallet/wallet.bridge';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import {
  MOBILE_MEDIA_QUERY,
  useMediaMatch,
} from '@gitroom/frontend/components/ui/media.match.hook';

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 4L4 12M4 4l8 8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const ChevronIcon: FC<{ back?: boolean }> = ({ back }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    className={back ? 'rotate-180' : undefined}
  >
    <path
      d="M6 3.5 10.5 8 6 12.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Previous and next over a set of images, and the dots under them; shared by
// the drawer's slides and the full-size viewer
const StepButton: FC<{
  back?: boolean;
  disabled: boolean;
  onClick: () => void;
  size: 'small' | 'large';
}> = ({ back, disabled, onClick, size }) => {
  const t = useT();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={back ? t('previous', 'Previous') : t('next', 'Next')}
      className={`absolute top-1/2 -translate-y-1/2 ${
        back ? 'left-[8px]' : 'right-[8px]'
      } ${
        size === 'large' ? 'w-[44px] h-[44px]' : 'w-[32px] h-[32px]'
      } rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center disabled:opacity-0 disabled:pointer-events-none transition-opacity`}
    >
      <ChevronIcon back={back} />
    </button>
  );
};

const StepDots: FC<{
  count: number;
  index: number;
  onPick: (index: number) => void;
}> = ({ count, index, onPick }) => {
  const t = useT();
  return (
    <div className="absolute bottom-[10px] inset-x-0 flex justify-center gap-[6px] pointer-events-none">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPick(i);
          }}
          aria-label={t('flows_go_to_image', 'Image {{number}}', {
            number: i + 1,
          })}
          aria-current={i === index}
          className={`pointer-events-auto w-[7px] h-[7px] rounded-full transition-colors ${
            i === index ? 'bg-white' : 'bg-white/40 hover:bg-white/70'
          }`}
        />
      ))}
    </div>
  );
};

const DetailSection: FC<{ title: string; children: ReactNode }> = ({
  title,
  children,
}) => (
  <div className="flex flex-col gap-[8px]">
    <div className="text-[12px] font-[500] uppercase tracking-[0.08em] text-textItemBlur">
      {title}
    </div>
    {children}
  </div>
);

const useCopyPrompt = (flow: Flow) => {
  const t = useT();
  const toaster = useToaster();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyPrompt = useCallback(() => {
    if (!flow.prompt) {
      return;
    }
    copy(flow.prompt);
    setCopied(true);
    toaster.show(
      t('flows_prompt_copied', 'Prompt copied. Paste it into your agent.'),
      'success'
    );
  }, [flow.prompt, t, toaster]);
  const label = copied
    ? t('flows_copied', 'Copied — now paste it into your agent')
    : t('flows_copy_prompt', 'Copy prompt');
  return { copyPrompt, label };
};

const PasteHint: FC = () => {
  const t = useT();
  return (
    <div className="text-[12px] leading-[1.5] text-textItemBlur">
      {t(
        'flows_paste_hint',
        'Paste this into Claude Cowork or ChatGPT Work with Studio connected.'
      )}{' '}
      {t('flows_not_connected', 'Not connected yet?')}{' '}
      <Link
        href="/settings?tab=agents"
        className="text-tealText font-[600] hover:underline"
      >
        {t('flows_connect_agent', 'Connect your agent')}
      </Link>
    </div>
  );
};

// The flow uses research data Plus opens: what is locked, that the flow
// still runs on free web research, and the way to Plus.
const ResearchLockNote: FC<{ flow: Flow }> = ({ flow }) => {
  const t = useT();
  const locked = useResearchLocked(flow);
  if (!locked) {
    return null;
  }
  return (
    <div className="flex items-start gap-[10px] rounded-[10px] px-[14px] py-[12px] bg-warmSoft text-[13px] leading-[1.5]">
      <span className="text-warm mt-[3px] shrink-0">
        <LockIcon size={14} />
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-[4px]">
        <div className="font-[600] text-warm">
          {t('plus_flows_research_locked', 'Research data with Plus')}
        </div>
        <div className="text-textItemBlur">
          {t(
            'plus_flows_research_locked_body',
            'This flow runs on free web research today. Plus adds review, social and search data.'
          )}
        </div>
        <button
          type="button"
          onClick={() => openPlus()}
          className="self-start text-warm font-[600] hover:underline"
        >
          {t('plus_get', 'Get Plus')}
        </button>
      </div>
    </div>
  );
};

// An image sample opens full size over the page; the x, Escape or a click
// anywhere closes it. A set (a carousel's slides) steps with the arrows, the
// arrow keys, a swipe or the dots.
const ImageViewer: FC<{
  images: string[];
  start?: number;
  onClose: () => void;
}> = ({ images, start = 0, onClose }) => {
  const t = useT();
  const [index, setIndex] = useState(start);
  const many = images.length > 1;
  const go = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(images.length - 1, next))),
    [images.length]
  );
  const step = useCallback(
    (by: number) =>
      setIndex((i) => Math.max(0, Math.min(images.length - 1, i + by))),
    [images.length]
  );
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (many && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.stopPropagation();
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, many, step]);
  // A horizontal swipe steps; a tap still closes
  const onTouchStart = (e: TouchEvent) => {
    swiped.current = false;
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const from = touch.current;
    touch.current = null;
    if (!from || !many) {
      return;
    }
    const dx = e.changedTouches[0].clientX - from.x;
    const dy = e.changedTouches[0].clientY - from.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true;
      go(index + (dx < 0 ? 1 : -1));
    }
  };
  const onClick = () => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    onClose();
  };
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={`fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 cursor-zoom-out ${
        many ? 'px-[60px] pt-[16px] pb-[40px] mobile:px-[8px]' : 'p-[16px]'
      }`}
    >
      <img
        src={images[index]}
        alt=""
        className="max-w-full max-h-full object-contain"
      />
      {many && (
        <>
          <StepButton
            back={true}
            size="large"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          />
          <StepButton
            size="large"
            disabled={index === images.length - 1}
            onClick={() => go(index + 1)}
          />
          <StepDots count={images.length} index={index} onPick={go} />
        </>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('close', 'Close')}
        className="absolute top-[16px] end-[16px] w-[40px] h-[40px] rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"
      >
        <CloseIcon />
      </button>
    </div>,
    document.body
  );
};

// A sample that is a set of images: one slide at a time, swiped on touch
// (native scroll snap), stepped with the arrows or the dots; a click opens
// that slide full size
const FlowSlides: FC<{
  images: string[];
  onOpen: (index: number) => void;
}> = ({ images, onOpen }) => {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const go = useCallback(
    (next: number) => {
      const el = track.current;
      if (!el) {
        return;
      }
      const to = Math.max(0, Math.min(images.length - 1, next));
      el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
    },
    [images.length]
  );
  const onScroll = () => {
    const el = track.current;
    if (el?.clientWidth) {
      setIndex(Math.round(el.scrollLeft / el.clientWidth));
    }
  };
  return (
    <>
      <div
        ref={track}
        dir="ltr"
        onScroll={onScroll}
        className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => onOpen(i)}
            aria-label={t(
              'flows_open_image',
              'Open image {{number}} full size',
              {
                number: i + 1,
              }
            )}
            className="relative w-full h-full shrink-0 snap-center cursor-zoom-in"
          >
            <img
              src={src}
              alt=""
              loading={i ? 'lazy' : undefined}
              className="w-full h-full object-contain"
            />
          </button>
        ))}
      </div>
      <span className="absolute top-[10px] end-[10px] inline-flex items-center h-[22px] px-[8px] rounded-full text-[11px] font-[600] bg-black/60 text-white pointer-events-none">
        {index + 1}/{images.length}
      </span>
      <StepButton
        back={true}
        size="small"
        disabled={index === 0}
        onClick={() => go(index - 1)}
      />
      <StepButton
        size="small"
        disabled={index === images.length - 1}
        onClick={() => go(index + 1)}
      />
      <StepDots count={images.length} index={index} onPick={go} />
    </>
  );
};

const FlowMedia: FC<{ flow: Flow }> = ({ flow }) => {
  const t = useT();
  // the image open full size, by its place in the sample
  const [enlarged, setEnlarged] = useState<number | null>(null);
  const close = useCallback(() => setEnlarged(null), []);
  const images =
    flow.exampleImages && flow.exampleImages.length > 1
      ? flow.exampleImages
      : flow.poster
      ? [flow.poster]
      : [];
  const box =
    flow.aspect === '9:16'
      ? 'aspect-[9/16] h-[60vh] max-w-full mx-auto'
      : flow.aspect === '4:5'
      ? 'aspect-[4/5] h-[60vh] max-w-full mx-auto'
      : flow.aspect === '1:1'
      ? 'aspect-square w-full max-w-[60vh] mx-auto'
      : 'aspect-video w-full';
  return (
    <div className={`relative rounded-[8px] overflow-hidden bg-black ${box}`}>
      {flow.exampleVideo ? (
        <video
          className="absolute inset-0 w-full h-full object-contain bg-black"
          src={flow.exampleVideo}
          poster={flow.poster}
          controls
          preload="metadata"
          playsInline
        />
      ) : images.length > 1 ? (
        <FlowSlides images={images} onOpen={setEnlarged} />
      ) : flow.poster ? (
        <button
          type="button"
          onClick={() => setEnlarged(0)}
          aria-label={t('flows_open_sample', 'Open the sample full size')}
          className="absolute inset-0 w-full h-full cursor-zoom-in"
        >
          <img
            src={flow.poster}
            alt=""
            className="w-full h-full object-contain"
          />
        </button>
      ) : (
        <>
          <FlowPoster flow={flow} />
          <span className="absolute bottom-[10px] end-[10px] inline-flex items-center h-[22px] px-[8px] rounded-full text-[11px] font-[600] bg-black/60 text-white">
            {t('flows_sample_soon', 'Sample coming soon')}
          </span>
        </>
      )}
      {enlarged !== null && !!images.length && (
        <ImageViewer images={images} start={enlarged} onClose={close} />
      )}
    </div>
  );
};

// Everything under the title, in the same order on desktop and phones. The
// Copy prompt button comes from the container: inline on desktop, pinned to
// the bottom of the sheet on phones.
const FlowDetailBody: FC<{
  flow: Flow;
  related: Flow[];
  cta?: ReactNode;
  onOpen: (id: string) => void;
}> = ({ flow, related, cta, onOpen }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[22px] pb-[8px]">
      {(!!flow.category || !!flow.cost || flow.free) && (
        <div className="flex items-center gap-[10px] flex-wrap text-[13px]">
          {!!flow.category && (
            <span className="inline-flex items-center h-[22px] px-[10px] rounded-full text-[12px] font-[600] bg-tealSoft text-tealText">
              {flowCategoryLabel(t, flow.category)}
            </span>
          )}
          <FlowCost flow={flow} />
        </div>
      )}
      <FlowMedia flow={flow} />
      <ResearchLockNote flow={flow} />
      <div className="flex flex-col gap-[8px]">
        {cta}
        <PasteHint />
      </div>
      <DetailSection title={t('flows_what_you_get', 'What you get')}>
        <div className="text-[14px] leading-[1.6] whitespace-pre-line">
          {flow.summary}
        </div>
        {!!flow.example && (
          <div className="text-[13px] leading-[1.5] text-textItemBlur">
            <span className="font-[600] text-newTextColor">
              {t('flows_example', 'Example:')}{' '}
            </span>
            {flow.example}
          </div>
        )}
        {!!flow.exampleLink && (
          <a
            href={flow.exampleLink}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-[13px] text-tealText font-[600] hover:underline"
          >
            {t('flows_see_example', 'See the example')}
          </a>
        )}
        {!!flow.outputs?.length && (
          <div className="flex items-center gap-[6px] flex-wrap text-[13px]">
            <span className="font-[600]">{t('flows_you_get', 'You get:')}</span>
            {flow.outputs.map((one) => (
              <span
                key={one}
                className="inline-flex items-center h-[22px] px-[8px] rounded-full text-[12px] border border-newTableBorder text-textItemBlur"
              >
                {one}
              </span>
            ))}
          </div>
        )}
      </DetailSection>
      {!!flow.inputs?.length && (
        <DetailSection
          title={t('flows_agent_asks', 'What your agent will ask you')}
        >
          <ul className="list-disc ps-[18px] text-[14px] leading-[1.6] flex flex-col gap-[2px]">
            {flow.inputs.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        </DetailSection>
      )}
      {(!!flow.duration || !!flow.cost || flow.free) && (
        <DetailSection
          title={
            flow.duration
              ? t('flows_takes_about', 'Takes about')
              : t('flows_cost_title', 'Cost')
          }
        >
          {!!flow.duration && (
            <div className="text-[14px]">{flow.duration}</div>
          )}
          <div className="text-[13px]">
            <FlowCost flow={flow} />
          </div>
        </DetailSection>
      )}
      {!!flow.prompt && (
        <details className="group rounded-[8px] border border-newTableBorder">
          <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden px-[12px] h-[40px] flex items-center text-[12px] font-[500] uppercase tracking-[0.08em] text-textItemBlur hover:text-newTextColor">
            <span className="flex-1">
              {t('flows_the_prompt', 'The prompt')}
            </span>
            <span className="group-open:rotate-180 transition-transform">
              ▾
            </span>
          </summary>
          <div
            dir="auto"
            className="mx-[12px] mb-[12px] rounded-[6px] bg-newBgColor p-[12px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words select-all"
          >
            {flow.prompt}
          </div>
        </details>
      )}
      {!!related.length && (
        <DetailSection title={t('flows_related', 'Related flows')}>
          <div className="grid grid-cols-3 gap-[8px]">
            {related.map((one) => (
              <FlowCard
                key={one.id}
                flow={one}
                playKey={`related:${one.id}`}
                playing={false}
                size="small"
                onOpen={onOpen}
              />
            ))}
          </div>
        </DetailSection>
      )}
    </div>
  );
};

const FlowAside: FC<{
  flow: Flow;
  related: Flow[];
  onClose: () => void;
  onOpen: (id: string) => void;
}> = ({ flow, related, onClose, onOpen }) => {
  const t = useT();
  const { copyPrompt, label } = useCopyPrompt(flow);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside
      className="w-[clamp(300px,30vw,480px)] shrink-0 bg-newBgColorInner border-s border-newTableBorder relative mobile:hidden"
      aria-label={flow.title}
    >
      <div className="absolute inset-0 overflow-y-auto p-[24px] flex flex-col gap-[16px]">
        <div className="flex items-start gap-[12px]">
          <div className="flex-1 min-w-0 text-[20px] font-[600] break-words">
            {flow.title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close', 'Close')}
            className="w-[28px] h-[28px] shrink-0 flex items-center justify-center rounded-[6px] text-textItemBlur hover:text-newTextColor hover:bg-newBgLineColor"
          >
            <CloseIcon />
          </button>
        </div>
        <FlowDetailBody
          flow={flow}
          related={related}
          onOpen={onOpen}
          cta={
            flow.prompt ? (
              <button
                type="button"
                onClick={copyPrompt}
                className="w-full h-[44px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[15px] font-[600] transition-all"
              >
                {label}
              </button>
            ) : null
          }
        />
      </div>
    </aside>
  );
};

const FlowSheet: FC<{
  flow: Flow;
  related: Flow[];
  onClose: () => void;
  onOpen: (id: string) => void;
}> = ({ flow, related, onClose, onOpen }) => {
  const { copyPrompt, label } = useCopyPrompt(flow);
  return (
    <BottomSheet
      title={flow.title}
      onClose={onClose}
      button={flow.prompt ? { label, onClick: copyPrompt } : undefined}
    >
      <FlowDetailBody flow={flow} related={related} onOpen={onOpen} />
    </BottomSheet>
  );
};

// A side panel on desktop, a bottom sheet on phones.
export const FlowDrawer: FC<{
  flow: Flow;
  related: Flow[];
  onClose: () => void;
  onOpen: (id: string) => void;
}> = (props) => {
  const mobile = useMediaMatch(MOBILE_MEDIA_QUERY);
  return mobile ? <FlowSheet {...props} /> : <FlowAside {...props} />;
};
