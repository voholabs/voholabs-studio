'use client';

import { useTrackView } from '@gitroom/helpers/utils/use.fire.events';
import React, { FC } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  useSupportedChannels,
  useWallet,
  useWalletFormat,
  useWalletPrices,
  useWalletResearchPrices,
} from '@gitroom/frontend/components/wallet/wallet.hooks';
import { openTopUp } from '@gitroom/frontend/components/wallet/wallet.events';
import { rateLine } from '@gitroom/frontend/components/wallet/wallet.text';
import {
  Loading,
  NoWallet,
  useHasWallet,
  WalletPageShell,
} from '@gitroom/frontend/components/wallet/wallet.billing';
import {
  BTN_PRIMARY,
  InfoIcon,
  PlusIcon,
} from '@gitroom/frontend/components/wallet/wallet.ui';
import { PriceList } from '@gitroom/frontend/components/wallet/wallet.price.list';
import { FlowsPricing } from '@gitroom/frontend/components/pricing/flows.pricing';
import { usePublicFlows } from '@gitroom/frontend/components/flows/flows.hooks';

// The Prices page, generated only from GET /wallet/prices: no per-row copy.
export const WalletPricesPage: FC = () => {
  const hasWallet = useHasWallet();
  return hasWallet ? <WalletPrices /> : <NoWallet />;
};

const WalletPrices: FC = () => {
  const t = useT();
  useTrackView('prices_viewed');
  const { data: wallet } = useWallet(true);
  const { data: sections, error } = useWalletPrices(true);
  const { data: channels } = useSupportedChannels(true);
  // An empty list when it fails, so the research row still shows.
  const { data: researchData, error: researchError } =
    useWalletResearchPrices(true);
  const research = researchData ?? (researchError ? [] : undefined);
  const { data: flows } = usePublicFlows();
  const f = useWalletFormat(wallet?.currency);

  if (!sections) {
    return error ? (
      <div className="flex-1 bg-newBgColorInner flex items-center justify-center text-textItemBlur text-[14px] p-[20px]">
        {t('wallet_prices_unavailable', 'Prices are not available right now.')}
      </div>
    ) : (
      <Loading />
    );
  }

  return (
    <WalletPageShell max={1400}>
      <div className="flex items-start gap-[16px] flex-wrap">
        <div className="flex-1 min-w-[280px] flex gap-[10px] items-start p-[14px] rounded-[8px] bg-newTableHeader text-[13px] leading-[1.5]">
          <span className="text-textItemBlur mt-[1px]">
            <InfoIcon />
          </span>
          <span>
            <span className="font-[600]">
              {t(
                'wallet_prices_follow',
                "Prices follow the provider's price and update automatically."
              )}
            </span>{' '}
            {!!wallet && (
              <span className="text-textItemBlur">
                {rateLine(t, f, wallet)}.
                {!wallet.legacy && (
                  <>
                    {' '}
                    {t(
                      'plus_prices_free_credits',
                      'Free credits pay for everything except what is marked "Included with Plus".'
                    )}
                  </>
                )}
              </span>
            )}
          </span>
        </div>
        {wallet?.topUpAllowed === false ? (
          <Link href="/plus" className={clsx(BTN_PRIMARY, 'shrink-0')}>
            <LockIcon size={14} /> {t('plus_get', 'Get Plus')}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => openTopUp()}
            className={clsx(BTN_PRIMARY, 'shrink-0')}
          >
            <PlusIcon /> {t('wallet_top_up', 'Top up')}
          </button>
        )}
      </div>
      <PriceList
        sections={sections}
        channels={channels}
        currency={wallet?.currency}
        research={research}
        open={!!wallet?.legacy}
      />
      <FlowsPricing flows={flows || []} />
    </WalletPageShell>
  );
};
