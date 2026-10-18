'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { usePlusPlan } from '@gitroom/frontend/components/plus/plus.hooks';
import { remainingMs } from '@gitroom/frontend/components/plus/plus.countdown';
import clsx from 'clsx';
import {
  EARLY_BIRD_SOFT,
  EARLY_BIRD_TEXT,
  EarlyBirdCode,
  EarlyBirdTimer,
  PlusBadgeIcon,
} from '@gitroom/frontend/components/plus/plus.offer';
import { PlusEarlyBird } from '@gitroom/frontend/components/plus/plus.types';

// Whether the early-bird bar shows: the workspace has a discount that is
// still running (the server's expiresAt), Plus is offered and it has no Plus
// yet. Closing it hides it until the page is loaded again; a new end time
// (the extension) shows it again. When the time runs out it hides itself
// and reads the plan again. On the Plus page it runs but is not shown: the
// page's own code strip shows the code and the time left (`running` keeps
// the Apex bar from taking its place there).
export const useEarlyBirdBanner = (enabled: boolean) => {
  const pathname = usePathname();
  const { data: plan, mutate } = usePlusPlan(enabled);
  const earlyBird = plan?.earlyBird || null;
  const offset = plan?.clockOffsetMs || 0;
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [expiredFor, setExpiredFor] = useState<string | null>(null);

  // One timer to the end, not a tick: the bar itself counts the seconds.
  useEffect(() => {
    if (!earlyBird) {
      return;
    }
    const left = remainingMs(earlyBird.expiresAt, offset);
    if (left <= 0) {
      setExpiredFor(earlyBird.expiresAt);
      return;
    }
    const timer = setTimeout(() => {
      setExpiredFor(earlyBird.expiresAt);
      mutate();
    }, Math.min(left, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [earlyBird, offset, mutate]);

  const running =
    enabled &&
    !!plan?.offer &&
    plan.paymentsEnabled &&
    !!earlyBird &&
    !plan.access.plus &&
    !plan.subscription?.active &&
    closedFor !== earlyBird.expiresAt &&
    expiredFor !== earlyBird.expiresAt;
  const show = running && !pathname?.startsWith('/plus');

  const dismiss = useCallback(() => {
    setClosedFor(earlyBird?.expiresAt || null);
  }, [earlyBird]);

  return { show, running, dismiss, earlyBird, offset };
};

// The bar across the top of the app while the early bird runs: the
// discount and its code to copy, the time left (on the server's clock) and
// the way to Plus. Same size as the Apex bar, so the layout moves the same
// 44px.
export const EarlyBirdBanner: FC<{
  earlyBird: PlusEarlyBird;
  offset: number;
  onClose: () => void;
}> = ({ earlyBird, offset, onClose }) => {
  const t = useT();
  return (
    <div
      role="region"
      aria-label={t('plus_early_bird_region', 'Plus offer')}
      className={clsx(
        EARLY_BIRD_SOFT,
        'relative flex justify-center items-center gap-x-[10px] h-[36px] mb-[8px] px-[44px] border border-warmRing rounded-[12px] text-[13px] whitespace-nowrap mobile:h-auto mobile:min-h-[36px] mobile:py-[6px] mobile:ps-[12px] mobile:pe-[36px] mobile:whitespace-normal mobile:flex-wrap mobile:gap-y-[4px] mobile:text-[12px]'
      )}
    >
      <span
        className={clsx('flex items-center gap-[6px] font-[600]', EARLY_BIRD_TEXT)}
      >
        <PlusBadgeIcon size={14} />
        {t('plus_early_bird_banner_code', '{{percent}}% off Plus with', {
          percent: earlyBird.percent,
        })}
      </span>
      <EarlyBirdCode code={earlyBird.code} compact={true} />
      <span aria-hidden="true" className="text-textItemBlur mobile:hidden">
        ·
      </span>
      <span className="text-newTextColor">
        {t('plus_early_bird_ends_in_cap', 'Ends in')}{' '}
        <EarlyBirdTimer
          expiresAt={earlyBird.expiresAt}
          offsetMs={offset}
          className={EARLY_BIRD_TEXT}
        />
      </span>
      <Link
        href="/plus"
        className="inline-flex items-center h-[26px] px-[12px] rounded-[6px] bg-warm text-black font-[700] hover:brightness-110 transition mobile:h-[32px]"
      >
        {t('plus_get', 'Get Plus')}
      </Link>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('apex_banner_close', 'Close')}
        title={t('apex_banner_close', 'Close')}
        className="absolute end-[8px] top-1/2 -translate-y-1/2 w-[24px] h-[24px] flex items-center justify-center rounded-[6px] text-textItemBlur hover:text-newTextColor hover:bg-newBgLineColor transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M1 1l8 8M9 1L1 9" />
        </svg>
      </button>
    </div>
  );
};
