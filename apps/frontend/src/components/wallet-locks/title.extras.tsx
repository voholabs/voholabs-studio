'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  findPrice,
  formatCredits,
  useWalletAccess,
  useWalletPrices,
} from '@gitroom/frontend/components/wallet-locks/wallet.access';
import {
  CoinsIcon,
  InfoIcon,
} from '@gitroom/frontend/components/wallet-locks/wallet.icons';

// Which price a page's coins hint explains.
const PAGE_ACTION: Record<string, string> = {
  '/brief': 'brief.onboarding',
};

const TOOLTIP_CLASS = '!max-w-[320px] !whitespace-normal !leading-[1.5] !text-[13px] !font-[400]';

// Pay-as-you-go only: how the page's paid action is charged. Teal, because
// the page is a feature the top-up opened.
const PageCoins: FC<{ actionKey: string }> = ({ actionKey }) => {
  const t = useT();
  const { data } = useWalletPrices();
  const action = findPrice(data, actionKey);
  if (!action || action.billing === 'UNLOCK') {
    return null;
  }
  const price = formatCredits(action.price);
  const free = action.freeUnits || 0;
  const hint =
    free && action.freePeriod === 'ONCE'
      ? free === 1
        ? t('wallet_hint_first_free', 'First time free, then {{price}} credits each time.', { price })
        : t('wallet_hint_first_n_free', 'First {{count}} times free, then {{price}} credits each time.', { count: free, price })
      : t('wallet_hint_each', '{{price}} credits each time.', { price });
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={hint}
      data-tooltip-id="tooltip"
      data-tooltip-content={hint}
      data-tooltip-class-name={TOOLTIP_CLASS}
      className="text-tealText cursor-help"
    >
      <CoinsIcon size={16} />
    </span>
  );
};

export const TitleExtras: FC<{ path: string; info?: string }> = ({
  path,
  info,
}) => {
  const access = useWalletAccess();
  // A locked page explains itself; the hints come once it is open.
  if (!access || access === 'free') {
    return null;
  }
  const actionKey = PAGE_ACTION[path];
  return (
    <>
      {!!info && (
        <span
          tabIndex={0}
          role="img"
          aria-label={info}
          data-tooltip-id="tooltip"
          data-tooltip-content={info}
          data-tooltip-class-name={TOOLTIP_CLASS}
          className="text-textItemBlur hover:text-newTextColor cursor-help"
        >
          <InfoIcon />
        </span>
      )}
      {access === 'payg' && !!actionKey && <PageCoins actionKey={actionKey} />}
    </>
  );
};
