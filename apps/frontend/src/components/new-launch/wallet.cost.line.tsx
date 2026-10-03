'use client';

import { FC, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
// @ts-ignore
import twitter from 'twitter-text';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  findPrice,
  formatCredits,
  useWalletAccess,
  useWalletPrices,
} from '@gitroom/frontend/components/wallet-locks/wallet.access';
import {
  openTopUp,
  useWalletSummary,
} from '@gitroom/frontend/components/wallet/wallet.bridge';
import { InfoIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';

// X bills a post with a link at a higher rate, and counts bare domains as
// links too, so the same parser X uses decides.
const hasLink = (html: string) => {
  const text = stripHtmlValidation('normal', html || '', true);
  try {
    return (twitter.extractUrls(text) as string[]).length > 0;
  } catch {
    return /https?:\/\/|www\./i.test(text);
  }
};

const signed = (hundredths: number) =>
  `${hundredths < 0 ? '−' : ''}${formatCredits(Math.abs(hundredths))}`;

const WalletCostLineInner: FC = () => {
  const t = useT();
  const { selectedIntegrations, global, internal } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      global: state.global,
      internal: state.internal,
    }))
  );

  const xChannels = useMemo(
    () =>
      selectedIntegrations.filter((p) => p.integration.identifier === 'x'),
    [selectedIntegrations]
  );

  const { data: prices } = useWalletPrices('x', xChannels.length > 0);
  const { data: wallet } = useWalletSummary(xChannels.length > 0);

  const postPrice = findPrice(prices, 'x.post')?.price ?? 0;
  const linkPrice = findPrice(prices, 'x.post_link')?.price ?? 0;

  // Every tweet is charged on its own: the post, each thread reply, each X
  // channel it goes to.
  const { cost, link } = useMemo(() => {
    let total = 0;
    let anyLink = false;
    for (const channel of xChannels) {
      const own = internal.find(
        (i) => i.integration.id === channel.integration.id
      )?.integrationValue;
      const values = own?.length ? own : global;
      for (const value of values) {
        const withLink =
          !channel.integration.stripLinks && hasLink(value.content);
        anyLink = anyLink || withLink;
        total += withLink ? linkPrice : postPrice;
      }
    }
    return { cost: total, link: anyLink };
  }, [xChannels, internal, global, postPrice, linkPrice]);

  if (!xChannels.length || !prices || !wallet || !cost) {
    return null;
  }

  const balance = wallet.balance ?? 0;
  const after = balance - cost;
  const enough = after >= 0;
  const autoCovers = !enough && !!wallet.autoTopUp?.enabled;
  // @ts-ignore - the summary has called this paidAmount
  const autoAmount: number | null = wallet.autoTopUp?.amount ?? wallet.autoTopUp?.paidAmount ?? null;
  const perUnit = wallet.topUp?.creditsPerUnit;
  const afterAuto =
    autoCovers && autoAmount && perUnit ? after + autoAmount * perUnit : null;

  const explain = t(
    'wallet_x_cost_info',
    'X charges per post. {{post}} credits without a link, {{link}} with one. Other channels are free.',
    { post: formatCredits(postPrice), link: formatCredits(linkPrice) }
  );

  return (
    <div className="px-[20px] py-[10px] border-t border-newBorder flex flex-col gap-[2px] select-none">
      <div className="flex items-center gap-[8px] text-[14px]">
        <img
          src="/icons/platforms/x.png"
          alt=""
          className="w-[16px] h-[16px] rounded-full"
        />
        <span>
          {t('wallet_post_costs', 'This post costs')}{' '}
          <span className="font-[600] tabular-nums">
            {t('wallet_n_credits', '{{credits}} credits', {
              credits: formatCredits(cost),
            })}
          </span>
          {link && (
            <span className="text-textItemBlur">
              {' '}
              {t('wallet_contains_link', '(contains a link)')}
            </span>
          )}
        </span>
        <span
          tabIndex={0}
          role="img"
          aria-label={explain}
          data-tooltip-id="tooltip"
          data-tooltip-content={explain}
          data-tooltip-class-name="!max-w-[300px] !whitespace-normal !leading-[1.5]"
          className="text-textItemBlur hover:text-newTextColor cursor-help"
        >
          <InfoIcon />
        </span>
      </div>
      {enough ? (
        <div className="text-[13px] text-textItemBlur tabular-nums ps-[24px]">
          {t('wallet_balance_after_n', 'Balance after: {{credits}}', {
            credits: signed(after),
          })}
        </div>
      ) : autoCovers ? (
        <div className="text-[13px] text-textItemBlur tabular-nums ps-[24px]">
          {t('wallet_auto_top_up_first', 'Auto top-up runs first.')}
          {afterAuto !== null &&
            ' ' +
              t('wallet_balance_after_n', 'Balance after: {{credits}}', {
                credits: signed(afterAuto),
              })}
        </div>
      ) : (
        <div className="text-[13px] ps-[24px] text-[#f2555a]">
          {t(
            'wallet_post_short',
            "Not enough credits yet. If you don't top up before it's due, this post won't go out."
          )}{' '}
          <button
            type="button"
            onClick={() => openTopUp()}
            className="underline underline-offset-2 font-[600] hover:opacity-80"
          >
            {t('wallet_top_up', 'Top up')}
          </button>{' '}
          <span className="text-textItemBlur tabular-nums">
            {t('wallet_balance_n', 'Balance: {{credits}}', {
              credits: signed(balance),
            })}
          </span>
        </div>
      )}
    </div>
  );
};

// Shown on wallet workspaces only (free plan, with or without a top-up), and
// only when an X channel is in the post. Scheduling is never blocked: credits
// are taken when the post goes out.
export const WalletCostLine: FC = () => {
  const access = useWalletAccess();
  if (access !== 'free' && access !== 'payg') {
    return null;
  }
  return <WalletCostLineInner />;
};
