'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { FlowCost } from '@gitroom/frontend/components/flows/flows.card';
import { Flow } from '@gitroom/frontend/components/flows/flows.hooks';
import {
  CARD,
  CoinsIcon,
  InfoIcon,
  PILL,
  PILL_TEAL,
  TEAL_TEXT,
  sectionIcon,
} from '@gitroom/frontend/components/wallet/wallet.ui';

// Flows and the AI generation inside them, one row per flow in the catalog
// (GET /public/flows): the cost line and estimate come from the flow itself.
// Shown under the price list on the public /pricing page and the in-app
// Prices page. /flows needs an account, so signed-out visitors get no Browse
// flows link: the Start free button below the card takes them to sign-up.
export const FlowsPricing: FC<{ flows: Flow[]; signedIn?: boolean }> = ({
  flows,
  signedIn = true,
}) => {
  const t = useT();

  return (
    <section className={clsx(CARD, 'overflow-hidden min-w-0')}>
      <div className="flex items-center gap-[12px] px-[20px] py-[16px] flex-wrap">
        <div className="w-[36px] h-[36px] rounded-[8px] bg-newBgLineColor flex items-center justify-center text-textItemBlur shrink-0">
          {sectionIcon('flows')}
        </div>
        <h2 className="flex-1 text-[16px] font-[600]">
          {t('pricing_flows_title', 'Flows and AI generation')}
        </h2>
        {signedIn && (
          <Link
            href="/flows"
            className="h-[32px] px-[12px] rounded-[8px] border border-newTableBorder text-[13px] text-textItemBlur hover:text-newTextColor hover:border-newSep flex items-center"
          >
            {t('pricing_flows_browse', 'Browse flows')}
          </Link>
        )}
      </div>
      <p className="px-[20px] pb-[16px] text-[14px] leading-[1.55] text-newTextColor/80">
        {t(
          'pricing_flows_body',
          'Flows are ready-made jobs your agent (Claude or ChatGPT) runs from one prompt, like a carousel in your brand or an ultra-realistic photo. AI generation inside a flow, such as images and voice-over, is paid from your wallet in credits, per use.'
        )}
      </p>
      {!!flows.length && (
        <ul>
          {flows.map((flow) => (
            <li
              key={flow.id}
              className="border-t border-newTableBorder px-[20px] py-[12px] min-h-[60px] flex flex-wrap items-center gap-x-[16px] gap-y-[8px] hover:bg-boxHover text-[14px]"
            >
              <div className="flex-1 min-w-[200px]">
                <div className="font-[600]">{flow.title}</div>
                <div className="text-[12px] text-textItemBlur line-clamp-2">
                  {flow.cost || flow.summary}
                </div>
              </div>
              {flow.costEstimate ? (
                <span className={clsx(PILL, 'gap-[5px] bg-warmSoft text-warm')}>
                  <CoinsIcon size={11} />{' '}
                  {t('wallet_legend_pay_per_use', 'Pay-per-use')}
                </span>
              ) : (
                <span className={PILL_TEAL}>
                  {t('wallet_model_free', 'Free')}
                </span>
              )}
              <span className="ms-auto sm:w-[240px] text-end font-[600] whitespace-nowrap">
                {flow.costEstimate ? (
                  <FlowCost flow={flow} short={true} />
                ) : (
                  <span className={TEAL_TEXT}>
                    {t('wallet_price_free', 'Free')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {flows.some((flow) => flow.free && flow.costEstimate) && (
        <div className="border-t border-newTableBorder bg-newTableHeader px-[20px] py-[14px] flex gap-[10px] items-start text-[13px] leading-[1.5]">
          <span className="text-textItemBlur mt-[1px] shrink-0">
            <InfoIcon />
          </span>
          <span>
            {t(
              'pricing_flows_note',
              'AI generation is free for now. The estimates show what it will cost later. Rendering happens in your own agent, so there is nothing extra to install. Scheduling and the brief stay included in your plan.'
            )}
          </span>
        </div>
      )}
    </section>
  );
};
