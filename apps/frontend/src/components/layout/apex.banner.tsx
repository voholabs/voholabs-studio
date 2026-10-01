'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Thin promo strip across the top of the app, in the warm brand accent.
export const ApexBanner: FC = () => {
  const t = useT();
  return (
    <div className="-mx-[12px] -mt-[12px] mb-[12px] bg-warmSoft border-b border-warm text-[13px] leading-none">
      <div className="h-[30px] flex items-center justify-center gap-[6px] px-[16px] text-newTextColor">
        <span>{t('apex_banner_question', 'Struggling to grow?')}</span>
        <a
          href="https://voholabs.com/apex"
          target="_blank"
          rel="noopener"
          className="font-[600] text-warm hover:underline whitespace-nowrap"
        >
          {t('apex_banner_link', 'Apex can help')} &rarr;
        </a>
      </div>
    </div>
  );
};
