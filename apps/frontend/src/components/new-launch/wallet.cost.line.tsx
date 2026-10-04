'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  EstimateRequest,
  findAction,
  useSupportedChannels,
  useWallet,
  useWalletEstimate,
  useWalletFormat,
  useWalletPrices,
} from '@gitroom/frontend/components/wallet/wallet.hooks';
import { titleCase } from '@gitroom/frontend/components/wallet/wallet.text';
import { openTopUp } from '@gitroom/frontend/components/wallet/wallet.bridge';
import { WalletEstimate } from '@gitroom/frontend/components/wallet/wallet.types';
import {
  TONE_TEXT,
  toneFor,
  useWalletAccess,
  WalletAccess,
} from '@gitroom/frontend/components/wallet-locks/wallet.access';
import {
  InfoIcon,
  LockIcon,
} from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import { ProviderLogo } from '@gitroom/frontend/components/wallet/wallet.ui';

// Waits until the value has been stable for `ms` before passing it on, so
// typing does not send an estimate per keystroke.
const useDebounced = <V,>(value: V, ms: number) => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
};

export interface ComposerWalletCost {
  access?: WalletAccess;
  // At least one channel is selected.
  selected: boolean;
  // Selected channels that charge per post, by provider.
  priced: string[];
  estimate?: WalletEstimate;
  loading: boolean;
}

// What the post in the composer costs from the wallet: one estimate per
// priced provider (POST /wallet/estimate, which owns the link rule), for
// wallet workspaces only. Shared by the cost line and the schedule toast.
export const useComposerWalletCost = (): ComposerWalletCost => {
  const access = useWalletAccess();
  const walletOrg = access === 'free' || access === 'payg';
  const { selectedIntegrations, global, internal } = useLaunchStore(
    useShallow((state) => ({
      selectedIntegrations: state.selectedIntegrations,
      global: state.global,
      internal: state.internal,
    }))
  );
  const { data: prices } = useWalletPrices(walletOrg);

  // Providers with a per-post price.
  const pricedProviders = useMemo(
    () =>
      new Set(
        (prices || [])
          .flatMap((s) => s.actions)
          .filter((a) => !!a.provider && a.billing === 'PER_USE')
          .map((a) => a.provider as string)
      ),
    [prices]
  );

  // Every post, thread reply and channel is charged on its own, so each
  // provider gets every content it would send.
  const requests = useMemo<EstimateRequest[]>(() => {
    if (!walletOrg) return [];
    const byProvider = new Map<string, string[]>();
    for (const channel of selectedIntegrations) {
      const provider = channel.integration.identifier;
      if (!pricedProviders.has(provider)) continue;
      const own = internal.find(
        (i) => i.integration.id === channel.integration.id
      )?.integrationValue;
      const values = own?.length ? own : global;
      byProvider.set(provider, [
        ...(byProvider.get(provider) || []),
        ...values.map((v) => v.content || ''),
      ]);
    }
    return [...byProvider.entries()].map(([provider, contents]) => ({
      provider,
      contents,
    }));
  }, [walletOrg, selectedIntegrations, internal, global, pricedProviders]);

  const settled = useDebounced(requests, 400);
  const { data: estimate, error } = useWalletEstimate(
    settled.length ? settled : null
  );

  return {
    access,
    selected: selectedIntegrations.length > 0,
    priced: requests.map((r) => r.provider),
    estimate: requests.length ? estimate : undefined,
    loading:
      (access === 'payg' && !prices) ||
      (requests.length > 0 && !estimate && !error),
  };
};

const signed = (credits: (n: number) => string, hundredths: number) =>
  `${hundredths < 0 ? '−' : ''}${credits(Math.abs(hundredths))}`;

const Skeleton: FC = () => (
  <div className="flex flex-col gap-[6px]" aria-hidden="true">
    <div className="h-[14px] w-[220px] max-w-full rounded-[4px] bg-newBgLineColor animate-pulse" />
    <div className="h-[12px] w-[140px] max-w-full rounded-[4px] bg-newBgLineColor animate-pulse ms-[24px]" />
  </div>
);

// The cost line in the composer footer: what the post costs and the balance
// after, or why it may not go out. Scheduling is never blocked: credits are
// taken when the post goes out.
export const WalletCostLine: FC<{ cost: ComposerWalletCost }> = ({ cost }) => {
  const t = useT();
  const walletOrg = cost.access === 'free' || cost.access === 'payg';
  const { data: wallet } = useWallet(walletOrg && cost.priced.length > 0);
  const { data: prices } = useWalletPrices(walletOrg);
  const f = useWalletFormat(wallet?.currency);

  if (!walletOrg || !cost.selected) {
    return null;
  }
  if (cost.loading || (cost.priced.length > 0 && !wallet)) {
    return <Skeleton />;
  }
  if (cost.priced.length && !cost.estimate) {
    // The estimate failed; the post itself is unaffected.
    return null;
  }
  if (!cost.priced.length || !cost.estimate) {
    return cost.access === 'payg' ? (
      <div className="text-[13px] text-textItemBlur">
        {t('wallet_no_credits_needed', 'No credits needed for these channels.')}
      </div>
    ) : null;
  }

  const { estimate } = cost;
  const link = estimate.items.some((i) => /_link$/.test(i.actionKey));
  const xPost = findAction(prices, 'x.post');
  const xLink = findAction(prices, 'x.post_link');
  const explain =
    cost.priced.includes('x') && xPost && xLink
      ? t(
          'wallet_x_cost_info',
          'X charges per post. {{post}} credits without a link, {{link}} with one. Other channels are free.',
          { post: f.credits(xPost.price), link: f.credits(xLink.price) }
        )
      : '';
  const perUnit = wallet?.topUp?.creditsPerUnit;
  // autoAmount is money (smallest currency unit); the balance is credits.
  const afterAuto =
    estimate.autoCovers && estimate.autoAmount && perUnit
      ? estimate.balanceAfter + f.creditsFor(estimate.autoAmount, perUnit)
      : null;

  return (
    <div className="flex flex-col gap-[2px] min-w-0">
      <div className="flex items-center gap-[8px] text-[14px]">
        <span className="flex items-center shrink-0">
          {cost.priced.map((p) => (
            <ProviderLogo key={p} provider={p} size={16} />
          ))}
        </span>
        <span className="min-w-0">
          {t('wallet_post_costs', 'This post costs')}{' '}
          <span className="font-[600] tabular-nums">
            {t('wallet_n_credits', '{{credits}} credits', {
              credits: f.credits(estimate.price),
            })}
          </span>
          {link && (
            <span className="text-textItemBlur">
              {' '}
              {t('wallet_contains_link', '(contains a link)')}
            </span>
          )}
        </span>
        {!!explain && (
          <span
            tabIndex={0}
            role="img"
            aria-label={explain}
            data-tooltip-id="tooltip"
            data-tooltip-content={explain}
            data-tooltip-class-name="!max-w-[300px] !whitespace-normal !leading-[1.5]"
            className="text-textItemBlur hover:text-newTextColor cursor-help shrink-0"
          >
            <InfoIcon />
          </span>
        )}
      </div>
      {!estimate.short && !estimate.autoCovers ? (
        <div className="text-[13px] text-textItemBlur tabular-nums ps-[24px]">
          {t('wallet_balance_after_n', 'Balance after: {{credits}}', {
            credits: signed(f.credits, estimate.balanceAfter),
          })}
        </div>
      ) : estimate.autoCovers ? (
        <div className="text-[13px] text-textItemBlur tabular-nums ps-[24px]">
          {afterAuto !== null && estimate.autoAmount
            ? t(
                'wallet_auto_adds_first',
                'Auto top-up adds {{amount}} first. Balance after: {{credits}}',
                {
                  amount: f.moneyShort(estimate.autoAmount),
                  credits: signed(f.credits, afterAuto),
                }
              )
            : t('wallet_auto_top_up_first', 'Auto top-up runs first.')}
        </div>
      ) : (
        <div className="text-[13px] ps-[24px] text-danger">
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
              credits: signed(f.credits, wallet?.balance ?? 0),
            })}
          </span>
        </div>
      )}
    </div>
  );
};

// Providers a top-up opens, with their display names.
const useLockedProviders = (enabled: boolean) => {
  const { data: prices } = useWalletPrices(enabled);
  const { data: channels } = useSupportedChannels(enabled);
  return useMemo(() => {
    const seen = new Map<string, { name: string; billing: string }>();
    for (const a of (prices || []).flatMap((s) => s.actions)) {
      if (!a.provider || !a.requiresTopUp || seen.has(a.provider)) continue;
      const channel = channels?.find((c) => c.identifier === a.provider);
      seen.set(a.provider, {
        name: channel
          ? channel.name.replace(/\n\(.*\)/, '').trim()
          : titleCase(a.provider),
        billing: a.billing,
      });
    }
    return [...seen.values()];
  }, [prices, channels]);
};

// Free plan: beside the channel avatars, which channels a top-up opens.
export const WalletLockHint: FC = () => {
  const t = useT();
  const access = useWalletAccess();
  const locked = useLockedProviders(access === 'free');
  if (access !== 'free' || !locked.length) {
    return null;
  }
  return (
    <div className="text-[12px] text-textItemBlur flex items-center gap-[6px] ms-[4px] whitespace-nowrap">
      <span className={TONE_TEXT[toneFor(locked[0].billing)]}>
        <LockIcon size={10} />
      </span>
      {t('wallet_unlocks_on_top_up', '{{names}} unlocks when you top up', {
        names: locked.map((l) => l.name).join(', '),
        interpolation: { escapeValue: false },
      })}
    </div>
  );
};

// Pay-as-you-go: the avatar tooltip of a channel that charges per post.
export const useWalletAvatarTip = () => {
  const t = useT();
  const access = useWalletAccess();
  const { data: prices } = useWalletPrices(access === 'payg');
  return useMemo(() => {
    if (access !== 'payg') return undefined;
    const priced = new Set(
      (prices || [])
        .flatMap((s) => s.actions)
        .filter((a) => !!a.provider && a.billing === 'PER_USE')
        .map((a) => a.provider as string)
    );
    return (integration: { identifier: string; name: string }) =>
      priced.has(integration.identifier)
        ? t('wallet_avatar_charges', '{{name}}. Charges credits per post', {
            name: integration.name,
            interpolation: { escapeValue: false },
          })
        : integration.name;
  }, [access, prices, t]);
};
