'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// One line of text centred in the top bar, for free-plan organizations.
export const ApexBanner: FC = () => {
  const t = useT();
  return (
    <div className="hidden xl:flex absolute start-1/2 -translate-x-1/2 rtl:translate-x-1/2 items-center gap-[6px] text-[14px] text-textItemBlur whitespace-nowrap">
      <span>{t('apex_banner_question', 'Struggling to grow?')}</span>
      <a
        href="https://voholabs.com/apex"
        target="_blank"
        rel="noopener"
        className="font-[700] text-warm hover:underline"
      >
        {t('apex_banner_link', 'Apex can help')} &rarr;
      </a>
    </div>
  );
};
