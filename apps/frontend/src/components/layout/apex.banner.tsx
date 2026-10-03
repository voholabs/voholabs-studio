'use client';

import { FC, useCallback, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const DISMISS_KEY = 'apex-banner-dismissed-at';
const DISMISS_DAYS = 7;

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
  return (
    <div className="relative flex justify-center items-center gap-[6px] h-[36px] mb-[8px] px-[44px] bg-newBgColorInner rounded-[12px] text-[13px] whitespace-nowrap">
      <span className="font-[600] text-newTextColor">
        {t('apex_banner_question', 'Struggling to grow?')}
      </span>
      <a
        href="https://voholabs.com/?utm_source=voholabs-studio&utm_medium=app-banner&utm_campaign=apex"
        target="_blank"
        rel="noopener"
        className="font-[700] text-warm hover:opacity-80 transition-opacity"
      >
        {t('apex_banner_link', 'Apex can help')} &rarr;
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
