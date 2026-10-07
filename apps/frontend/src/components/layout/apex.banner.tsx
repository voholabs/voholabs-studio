'use client';

import { FC, useCallback, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const DISMISS_KEY = 'apex-banner-dismissed-at';
const DISMISS_DAYS = 7;
const VARIANT_KEY = 'apex-banner-variant';

// Three wordings under test. Each browser is given one at random and keeps it,
// so a person always sees the same banner. The link carries the variant id in
// utm_content, so clicks per wording can be compared on voholabs.com.
const VARIANTS = [
  {
    id: 'more-than-a-tool',
    questionKey: 'apex_banner_question_tool',
    question: 'Need more than a tool?',
    linkKey: 'apex_banner_link_tool',
    link: 'Let us run it for you',
  },
  {
    id: 'struggling-to-grow',
    questionKey: 'apex_banner_question',
    question: 'Struggling to grow?',
    linkKey: 'apex_banner_link',
    link: 'Apex can help',
  },
  {
    id: 'done-for-you',
    questionKey: 'apex_banner_question_dfy',
    question: 'Looking for done-for-you marketing?',
    linkKey: 'apex_banner_link_dfy',
    link: 'We can help',
  },
] as const;

const pickVariant = () => {
  try {
    const saved = VARIANTS.find(
      (v) => v.id === localStorage.getItem(VARIANT_KEY)
    );
    if (saved) {
      return saved;
    }
  } catch {
    // Storage blocked: pick at random for this page load.
  }
  const picked = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
  try {
    localStorage.setItem(VARIANT_KEY, picked.id);
  } catch {
    // Not saved; the next load may pick a different one.
  }
  return picked;
};

const dismissedRecently = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return !!at && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

// Whether the Apex banner shows, and a way to close it. Closing it hides it on
// this browser for 7 days, then it comes back.
export const useApexBanner = (eligible: boolean) => {
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && dismissedRecently()
  );
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage blocked: it stays closed until the page reloads.
    }
    setDismissed(true);
  }, []);
  return { show: eligible && !dismissed, dismiss };
};

// A bar across the top of the page for free-plan organizations. It is 36px
// tall with an 8px gap below, so everything under it moves down 44px.
export const ApexBanner: FC<{ onClose: () => void }> = ({ onClose }) => {
  const t = useT();
  const [variant] = useState(pickVariant);
  return (
    <div className="relative flex justify-center items-center gap-[6px] h-[36px] mb-[8px] px-[44px] bg-newBgColorInner rounded-[12px] text-[13px] whitespace-nowrap">
      <span className="font-[600] text-newTextColor">
        {t(variant.questionKey, variant.question)}
      </span>
      <a
        href={`https://voholabs.com/?utm_source=voholabs-studio&utm_medium=app-banner&utm_campaign=apex&utm_content=${variant.id}`}
        target="_blank"
        rel="noopener"
        className="font-[700] text-warm hover:opacity-80 transition-opacity"
      >
        {t(variant.linkKey, variant.link)} &rarr;
      </a>
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
