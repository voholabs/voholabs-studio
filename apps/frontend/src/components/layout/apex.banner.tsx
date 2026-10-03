'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// One line of text in a strip across the top of the page, for free-plan
// organizations. It is 32px tall and starts in the 12px page padding, so it
// pushes everything below it down 20px.
export const ApexBanner: FC = () => {
  const t = useT();
  return (
    <div className="flex justify-center items-center gap-[6px] h-[32px] -mt-[12px] text-[14px] whitespace-nowrap">
      <span className="font-[600] text-newTextColor">
        {t('apex_banner_question', 'Struggling to grow?')}
      </span>
      <a
        href="https://voholabs.com/?utm_source=voholabs-studio&utm_medium=app-banner&utm_campaign=apex"
        target="_blank"
        rel="noopener"
        className="font-[700] text-warm hover:underline"
      >
        {t('apex_banner_link', 'Apex can help')} &rarr;
      </a>
    </div>
  );
};
