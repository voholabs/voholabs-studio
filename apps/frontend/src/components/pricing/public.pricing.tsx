'use client';

import React, { FC, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useWalletFormat } from '@gitroom/frontend/components/wallet/wallet.hooks';
import { ENABLED_PROVIDERS } from '@gitroom/frontend/components/launches/enabled.providers';
import { PriceList } from '@gitroom/frontend/components/wallet/wallet.price.list';
import { FlowsPricing } from '@gitroom/frontend/components/pricing/flows.pricing';
import { Flow } from '@gitroom/frontend/components/flows/flows.hooks';
import {
  BTN_PRIMARY,
  CoinsIcon,
} from '@gitroom/frontend/components/wallet/wallet.ui';
import {
  SupportedChannel,
  WalletPriceSection,
  WalletResearchPrice,
} from '@gitroom/frontend/components/wallet/wallet.types';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import ModeComponent from '@gitroom/frontend/components/layout/mode.component';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { PlusOfferCard } from '@gitroom/frontend/components/plus/plus.offer';
import { clockOffset } from '@gitroom/frontend/components/plus/plus.countdown';
import {
  PlusEarlyBird,
  PlusOffer,
} from '@gitroom/frontend/components/plus/plus.types';

// GET /public/prices
export interface PublicPrices {
  currency: string | null;
  creditsPerUnit: number | null;
  topUp: { minAmount: number; options: number[] } | null;
  sections: WalletPriceSection[];
  channels: SupportedChannel[];
  // What each kind of research data typically costs per run.
  research?: WalletResearchPrice[];
  // The Plus offer; null when Plus is not offered.
  plus?: PlusOffer | null;
}

// For a signed-in workspace: its early bird (GET /wallet/plus, read by the
// page on the server) and the server's time when it was read.
export interface PublicEarlyBird {
  earlyBird: PlusEarlyBird | null;
  serverNow: string;
  plus: boolean;
}

const raw = { interpolation: { escapeValue: false } };

// The public /pricing page: the same price list as the in-app Prices page,
// with the rate and top-up rules, for visitors who are not signed in.
export const PublicPricing: FC<{
  prices: PublicPrices | null;
  // GET /public/flows
  flows: Flow[];
  signedIn: boolean;
  earlyBird?: PublicEarlyBird | null;
}> = ({ prices, flows, signedIn, earlyBird }) => {
  const t = useT();
  const f = useWalletFormat(prices?.currency || undefined);
  const [offset] = useState(() => clockOffset(earlyBird?.serverNow));
  // Past its end the card shows the list price; reloading reads it again.
  const [expired, setExpired] = useState(false);

  const channels = useMemo(
    () =>
      (prices?.channels || []).filter((c) =>
        ENABLED_PROVIDERS.includes(c.identifier)
      ),
    [prices]
  );

  const rate =
    prices?.currency && prices.creditsPerUnit
      ? t('wallet_rate_line', '{{money}} = {{credits}} credits', {
          money: f.moneyShort(f.factor),
          credits: f.number(prices.creditsPerUnit),
          ...raw,
        })
      : '';

  const cta = signedIn ? (
    <Link href="/" className={clsx(BTN_PRIMARY, 'shrink-0')}>
      {t('pricing_open_studio', 'Open Studio')}
    </Link>
  ) : (
    <Link href="/auth" className={clsx(BTN_PRIMARY, 'shrink-0')}>
      {t('pricing_start_free', 'Start free')}
    </Link>
  );

  return (
    <div className="w-full min-h-screen bg-newBgColor text-newTextColor">
      <ToolTip />
      <header className="border-b border-newBorder">
        <div className="max-w-[1200px] mx-auto px-[16px] sm:px-[20px] h-[64px] flex items-center gap-[16px]">
          <Link
            href="/"
            aria-label="Voholabs Studio"
            className="flex items-center shrink-0 [&_svg]:h-auto [&_svg]:w-[170px] sm:[&_svg]:w-[220px]"
          >
            <LogoTextComponent />
          </Link>
          <span className="flex-1" />
          <ModeComponent />
          {!signedIn && (
            <Link
              href="/auth/login"
              className="text-[14px] text-textItemBlur hover:text-newTextColor whitespace-nowrap"
            >
              {t('pricing_sign_in', 'Sign in')}
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-[16px] sm:px-[20px] py-[40px] sm:py-[60px] flex flex-col gap-[20px]">
        <div className="flex flex-col gap-[16px] pb-[20px]">
          <h1 className="text-[32px] sm:text-[44px] leading-[1.1] font-[600]">
            {t('pricing_title', 'Pay only for what you use')}
          </h1>
          <div className="flex flex-wrap items-center gap-[12px] pt-[8px]">
            {cta}
            {!!rate && (
              <span className="inline-flex items-center gap-[8px] h-[44px] px-[14px] rounded-[8px] bg-tealSoft text-tealText text-[15px] font-[600] tabular-nums">
                <CoinsIcon size={14} /> {rate}
              </span>
            )}
          </div>
        </div>

        {!!prices?.plus && !earlyBird?.plus && (
          <section className="w-full max-w-[880px] self-center py-[12px]">
            <PlusOfferCard
              offer={prices.plus}
              earlyBird={expired ? null : earlyBird?.earlyBird || null}
              offsetMs={offset}
              onExpire={() => setExpired(true)}
              subscribeHref={signedIn ? '/plus' : '/auth'}
              hero={true}
            />
          </section>
        )}

        {prices?.sections.length ? (
          <PriceList
            sections={prices.sections}
            channels={channels}
            currency={prices.currency || undefined}
            research={prices.research || []}
          />
        ) : (
          <div className="rounded-[12px] border border-newTableBorder p-[40px] text-center text-textItemBlur text-[14px]">
            {t(
              'wallet_prices_unavailable',
              'Prices are not available right now.'
            )}
          </div>
        )}

        <FlowsPricing flows={flows} signedIn={signedIn} />

        <div className="mt-[20px] rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[24px] flex flex-col sm:flex-row sm:items-center gap-[16px]">
          <div className="flex-1 flex flex-col gap-[4px]">
            <h2 className="text-[20px] font-[600]">
              {t('pricing_cta_title_plus', 'Start free, get Plus when you need more')}
            </h2>
            <p className="text-[14px] text-textItemBlur">
              {t(
                'pricing_cta_body',
                'Create an account, connect your channels and schedule your first posts.'
              )}
            </p>
          </div>
          {cta}
        </div>
      </main>

      <footer className="border-t border-newBorder">
        <div className="max-w-[1200px] mx-auto px-[16px] sm:px-[20px] py-[24px] flex flex-wrap gap-x-[20px] gap-y-[8px] text-[13px] text-textItemBlur">
          <span>© Voholabs Ltd</span>
          <Link href="/privacy" className="hover:underline">
            {t('pricing_privacy', 'Privacy Policy')}
          </Link>
          <Link href="/terms" className="hover:underline">
            {t('pricing_terms', 'Terms of Service')}
          </Link>
          <a href="mailto:hello@voholabs.com" className="hover:underline">
            hello@voholabs.com
          </a>
          <a
            href="https://github.com/voholabs/voholabs-studio"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {t('pricing_source', 'Source code (AGPL-3.0)')}
          </a>
        </div>
      </footer>
    </div>
  );
};
