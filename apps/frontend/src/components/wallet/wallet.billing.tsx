'use client';

import {
  useFireEvents,
  useTrackView,
} from '@gitroom/helpers/utils/use.fire.events';
import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import {
  useRefreshWallet,
  useWallet,
  useWalletFormat,
  useWalletPrices,
  useWalletTransactions,
  useWalletUsage,
  WalletFormat,
} from '@gitroom/frontend/components/wallet/wallet.hooks';
import { openTopUp } from '@gitroom/frontend/components/wallet/wallet.events';
import { openPlus } from '@gitroom/frontend/components/wallet/wallet.bridge';
import { LockIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';
import {
  PILL_PLUS,
  PlusCredits,
} from '@gitroom/frontend/components/plus/plus.offer';
import {
  cardLabel,
  useIsWalletAdmin,
} from '@gitroom/frontend/components/wallet/top.up.modal';
import {
  ForecastNotice,
  isLow,
  lowThreshold,
} from '@gitroom/frontend/components/wallet/wallet.header';
import { rateLine } from '@gitroom/frontend/components/wallet/wallet.text';
import { WalletCheckoutReturn } from '@gitroom/frontend/components/wallet/wallet.return';
import { PlusPaymentFailedNotice } from '@gitroom/frontend/components/plus/plus.panel';
import { usePlusPlan } from '@gitroom/frontend/components/plus/plus.hooks';
import {
  actionName,
  txName,
  txTypeLabel,
} from '@gitroom/frontend/components/wallet/wallet.text';
import {
  WalletPricedAction,
  WalletSummary,
} from '@gitroom/frontend/components/wallet/wallet.types';
import {
  ArrowIcon,
  BTN_PRIMARY,
  BTN_SIMPLE,
  CARD,
  CardIcon,
  ChevronIcon,
  EmptyState,
  InfoTip,
  Num,
  PILL,
  PILL_MUTED,
  PILL_TEAL,
  PlusIcon,
  POS_SOFT,
  POS_TEXT,
  ProviderLogo,
  SCROLL,
  Spinner,
  TEAL_SOFT,
  TEAL_TEXT,
} from '@gitroom/frontend/components/wallet/wallet.ui';

// Paid plans have no wallet: the pages say so instead of rendering it.
export const useHasWallet = () => {
  const user = useUser();
  return user?.tier?.current === 'FREE';
};

// A paid plan has no wallet: its URLs go to the plan's own billing page, as
// they did before the wallet existed.
export const NoWallet: FC = () => {
  const router = useRouter();
  useEffect(() => {
    router.replace('/billing');
  }, [router]);
  return null;
};

export const Loading: FC = () => (
  <div className="flex-1 bg-newBgColorInner flex items-center justify-center py-[80px]">
    <Spinner />
  </div>
);

const usePriceLookup = () => {
  const { data } = useWalletPrices();
  return useCallback(
    (key: string): WalletPricedAction | undefined =>
      data?.flatMap((s) => s.actions).find((a) => a.key === key),
    [data]
  );
};

const Toggle: FC<{
  on: boolean;
  label: string;
  disabled?: boolean;
  // Shows a lock on the knob: the switch needs Plus.
  locked?: boolean;
  onChange: () => void;
}> = ({ on, label, disabled, locked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={clsx(
      'relative w-[40px] h-[22px] rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed',
      on ? 'bg-btnPrimary' : 'bg-btnSimple'
    )}
  >
    <span
      className={clsx(
        'absolute top-[3px] w-[16px] h-[16px] rounded-full bg-white transition-all flex items-center justify-center text-black',
        on ? 'start-[21px]' : 'start-[3px]'
      )}
    >
      {locked && <LockIcon size={10} />}
    </span>
  </button>
);

const SelectBox: FC<{
  value: number;
  options: number[];
  disabled?: boolean;
  label: string;
  render: (v: number) => string;
  onChange: (v: number) => void;
}> = ({ value, options, disabled, label, render, onChange }) => (
  <span className="relative inline-flex">
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="appearance-none h-[36px] ps-[12px] pe-[28px] bg-newBgColorInner border border-newTableBorder rounded-[8px] text-[14px] font-[600] tabular-nums hover:border-newSep disabled:opacity-50 cursor-pointer outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {render(o)}
        </option>
      ))}
    </select>
    <span className="pointer-events-none absolute end-[10px] top-1/2 -translate-y-1/2 text-textItemBlur">
      <ChevronIcon />
    </span>
  </span>
);

const Segmented: FC<{
  items: [string, string][];
  value: string;
  onChange: (v: string) => void;
}> = ({ items, value, onChange }) => (
  <div
    className="flex flex-row p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500]"
    role="tablist"
  >
    {items.map(([k, l]) => (
      <button
        key={k}
        type="button"
        role="tab"
        aria-selected={value === k}
        onClick={() => onChange(k)}
        className={clsx(
          'px-[14px] py-[6px] rounded-[6px] transition-colors',
          value === k
            ? 'bg-boxFocused text-textItemFocused'
            : 'text-textItemBlur hover:text-newTextColor'
        )}
      >
        {l}
      </button>
    ))}
  </div>
);

// Pay-as-you-go from before Plus: Plus is offered as an option, from the
// Plus offer (credits a month and the monthly price).
const LegacyPlusNote: FC<{ f: WalletFormat }> = ({ f }) => {
  const t = useT();
  const { data: plan } = usePlusPlan(true);
  const monthly = plan?.offer?.intervals.find((i) => i.interval === 'month');
  return (
    <div className="text-[14px] leading-[1.55] text-newTextColor/80">
      {plan?.offer && monthly
        ? t(
            'plus_legacy_offer',
            "You're on pay-as-you-go. Plus gives you {{credits}} credits a month for {{price}}.",
            {
              credits: plan.offer.creditsPerPeriod,
              price: f.money(monthly.price),
            }
          )
        : t('plus_legacy_short', "You're on pay-as-you-go.")}{' '}
      <Link
        href="/plus"
        className="text-newTextColor underline underline-offset-2 hover:text-btnPrimary"
      >
        {t('plus_see', 'See Plus')}
      </Link>
    </div>
  );
};

const BalanceCard: FC<{
  wallet: WalletSummary;
  f: WalletFormat;
  showTransactions: () => void;
}> = ({ wallet, f, showTransactions }) => {
  const t = useT();
  const paid = wallet.payAsYouGo;
  const low = isLow(wallet) || wallet.balance < 0;
  const needsPlus = wallet.topUpAllowed === false;
  // Topped up before Plus: the credits keep working, top-ups need Plus.
  const grandfathered = paid && !wallet.plus && needsPlus;
  return (
    <div className={clsx(CARD, 'p-[24px] flex flex-col gap-[20px] min-w-0')}>
      <div className="flex items-center justify-between gap-[8px]">
        <div className="text-[14px] text-textItemBlur">
          {t('wallet_balance_title', 'Balance')}
        </div>
        {wallet.frozen ? (
          <span className={PILL_MUTED}>{t('wallet_on_hold', 'On hold')}</span>
        ) : wallet.plus ? (
          <span className={PILL_PLUS}>{t('plus_name', 'Plus')}</span>
        ) : paid ? (
          <span className={PILL_TEAL}>{t('wallet_payg', 'Pay-as-you-go')}</span>
        ) : (
          <span className={PILL_MUTED}>
            {t('wallet_free_plan', 'Free plan')}
          </span>
        )}
      </div>
      <div>
        <div className="flex items-baseline flex-wrap gap-[10px]">
          <span
            className={clsx(
              'text-[clamp(34px,3.2vw,48px)] font-[600] leading-none tabular-nums',
              low && 'text-warm'
            )}
          >
            <Num>{f.credits(wallet.balance)}</Num>
          </span>
          <span className="text-[16px] text-textItemBlur">
            {t('wallet_credits', 'credits')}
          </span>
        </div>
        {!!wallet.topUp && (
          <div className="text-[14px] text-textItemBlur mt-[10px] tabular-nums">
            ≈ {f.money(f.moneyFor(wallet.balance, wallet.topUp.creditsPerUnit))}
            <span className="mx-[6px] text-newSep">|</span>
            {rateLine(t, f, wallet)}
          </div>
        )}
      </div>
      {!!wallet.credits && (wallet.plus || wallet.credits.plan > 0) && (
        <PlusCredits credits={wallet.credits} currency={wallet.currency} />
      )}
      <ForecastNotice wallet={wallet} />
      {!!wallet.legacy && !wallet.frozen && <LegacyPlusNote f={f} />}
      {grandfathered && !wallet.frozen && (
        <div className="text-[14px] leading-[1.55] text-newTextColor/80">
          {t(
            'plus_grandfathered_note',
            'Your credits keep working until they are used up. Top-ups need Plus.'
          )}
        </div>
      )}
      {wallet.frozen && (
        <div className="text-[14px] leading-[1.55] text-newTextColor/80">
          {t(
            'wallet_frozen',
            'This wallet is on hold. Contact support to restore it.'
          )}
        </div>
      )}
      {!wallet.frozen && !!wallet.plusPaymentFailed && (
        <PlusPaymentFailedNotice />
      )}
      {!paid && !wallet.frozen && (
        <div className="text-[14px] leading-[1.55] text-newTextColor/80">
          {t(
            'wallet_free_explainer',
            'Credits pay for pay-per-use features. Everything free stays free.'
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-[8px] mt-auto">
        {wallet.frozen ||
        (needsPlus && wallet.plusPaymentFailed) ? null : needsPlus ? (
          <Link
            href="/plus"
            className={clsx(BTN_PRIMARY, 'flex-1 min-w-[160px]')}
          >
            <LockIcon size={14} /> {t('plus_get', 'Get Plus')}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => openTopUp()}
            className={clsx(BTN_PRIMARY, 'flex-1 min-w-[160px]')}
          >
            <PlusIcon /> {t('wallet_top_up', 'Top up')}
          </button>
        )}
        {!!wallet.plus && (
          <Link href="/plus" className={BTN_SIMPLE}>
            {t('plus_manage', 'Manage Plus')}
          </Link>
        )}
        {paid && (
          <button
            type="button"
            onClick={showTransactions}
            className={BTN_SIMPLE}
          >
            {t('wallet_transactions', 'Transactions')}
          </button>
        )}
      </div>
    </div>
  );
};

const uniqueSorted = (values: number[]) =>
  [...new Set(values.filter((v) => v > 0))].sort((a, b) => a - b);

const AutoTopUpCard: FC<{ wallet: WalletSummary; f: WalletFormat }> = ({
  wallet,
  f,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const refresh = useRefreshWallet();
  const isAdmin = useIsWalletAdmin();
  const paid = wallet.payAsYouGo;
  const minAmount = wallet.topUp?.minAmount || 0;
  const autoOptions = wallet.topUp?.autoOptions;
  const settingCaps = wallet.topUp?.capOptions;
  const [form, setForm] = useState(() => {
    const amount =
      wallet.autoTopUp.amount ||
      autoOptions?.[0] ||
      wallet.topUp?.minAmount ||
      0;
    return {
      threshold: f.plainCredits(lowThreshold(wallet)),
      amount,
      cap:
        wallet.autoTopUp.monthlyCap ||
        settingCaps?.find((c) => c >= amount) ||
        amount * 5,
    };
  });
  const [saving, setSaving] = useState(false);
  const [changingCard, setChangingCard] = useState(false);
  const on = paid && wallet.autoTopUp.enabled;
  const fireEvents = useFireEvents();
  // Auto top-up is a top-up, so it needs Plus; turning it off never does.
  const needsPlus = wallet.topUpAllowed === false;
  // A failing Plus payment pauses it (the server refuses turning it on).
  const paused = !!wallet.plusPaymentFailed;
  const canEdit =
    paid &&
    isAdmin &&
    !!wallet.card &&
    !wallet.frozen &&
    (on || (!needsPlus && !paused));
  // Off and needing Plus: the switch and the settings open the Plus dialog.
  const locked = needsPlus && !on && !wallet.frozen;
  // With Plus and no card yet, turning it on saves a card first.
  const addsCard =
    paid && isAdmin && !wallet.card && !wallet.frozen && !needsPlus;
  const offReason = on ? null : wallet.autoTopUp.offReason;

  // Choices come from the billing settings; the saved values always stay
  // selectable.
  const amountOptions = useMemo(
    () =>
      uniqueSorted([
        ...(autoOptions?.length ? autoOptions : wallet.topUp?.options || []),
        form.amount,
      ]),
    [autoOptions, wallet.topUp?.options, form.amount]
  );
  const capOptions = useMemo(
    () =>
      uniqueSorted([
        ...(settingCaps?.length
          ? settingCaps
          : [2, 5, 10, 25].map((k) => k * form.amount)),
        form.cap,
      ]).filter((v) => v >= form.amount),
    [settingCaps, form.amount, form.cap]
  );

  const thresholdHundredths = f.parseCredits(form.threshold);

  // Swaps the saved card through Stripe (setup mode); Stripe sends the user
  // back to /wallet?card=saved or ?card=cancelled. `autoTopUp` turns auto
  // top-up on once the card is saved.
  const changeCard = useCallback(async (autoTopUp = false) => {
    setChangingCard(true);
    try {
      const res = await fetch('/wallet/card', {
        method: 'POST',
        ...(autoTopUp ? { body: JSON.stringify({ autoTopUp: true }) } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.url) {
        window.location.href = body.url;
        return;
      }
    } catch {
      // Falls through to the message below.
    }
    setChangingCard(false);
    toaster.show(
      t(
        'wallet_card_change_failed',
        'The card could not be changed. Please try again.'
      ),
      'warning'
    );
  }, [fetch, toaster, t]);

  const save = useCallback(
    async (enabled: boolean, message: string) => {
      setSaving(true);
      try {
        const res = await fetch('/wallet/auto-top-up', {
          method: 'PATCH',
          body: JSON.stringify({
            enabled,
            threshold: thresholdHundredths,
            amount: form.amount,
            monthlyCap: Math.max(form.cap, form.amount),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toaster.show(
            t('wallet_auto_save_failed', 'Auto top-up could not be saved.'),
            'warning'
          );
          return;
        }
        if (enabled !== on) fireEvents('auto_topup_toggled', { enabled });
        toaster.show(message);
        await refresh(body?.balance !== undefined ? body : undefined);
      } catch {
        toaster.show(
          t('wallet_auto_save_failed', 'Auto top-up could not be saved.'),
          'warning'
        );
      } finally {
        setSaving(false);
      }
    },
    [fetch, toaster, t, thresholdHundredths, form, refresh, on, fireEvents]
  );

  const used = wallet.autoTopUp.usedThisMonth || 0;
  const cap = wallet.autoTopUp.monthlyCap || form.cap;
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const now = new Date();
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return (
    <div className={clsx(CARD, 'p-[24px] flex flex-col gap-[18px] min-w-0')}>
      <div className="flex items-start gap-[16px]">
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-[600]">
            {t('wallet_auto_title', 'Auto top-up')}
          </div>
          <div className="text-[13px] text-textItemBlur mt-[4px]">
            {paused ? (
              t(
                'wallet_auto_paused',
                'Auto top-up is paused while your Plus payment is failing. Update your card on the Plus page to start it again.'
              )
            ) : needsPlus && offReason === 'plus_ended' ? (
              t(
                'wallet_auto_off_plus_ended',
                'Auto top-up turned off when your Plus ended. It comes back with Plus.'
              )
            ) : locked ? (
              <>
                {t('plus_auto_comes_with_plus', 'Auto top-up comes with Plus.')}{' '}
                <button
                  type="button"
                  onClick={() => openPlus()}
                  className="text-newTextColor underline underline-offset-2 hover:text-btnPrimary"
                >
                  {t('plus_get', 'Get Plus')}
                </button>
              </>
            ) : !wallet.card ? (
              t(
                'wallet_auto_add_card',
                'Turn this on to save a card. Nothing is charged until your balance runs low.'
              )
            ) : offReason === 'card_failed' ? (
              t(
                'wallet_auto_off_card_failed',
                'Auto top-up turned off because your card could not be charged. Update your card, then turn it back on.'
              )
            ) : (
              t(
                'wallet_auto_explainer',
                'Keeps pay-per-use features running when your balance runs low.'
              )
            )}
          </div>
        </div>
        <Toggle
          on={on}
          label={t('wallet_auto_title', 'Auto top-up')}
          locked={locked}
          disabled={
            !locked && (!(canEdit || addsCard) || saving || changingCard)
          }
          onChange={() =>
            locked
              ? openPlus()
              : addsCard
              ? changeCard(true)
              : save(
                  !on,
                  !on
                    ? t('wallet_auto_turned_on', 'Auto top-up turned on')
                    : t('wallet_auto_turned_off', 'Auto top-up turned off')
                )
          }
        />
      </div>
      <div
        className={clsx(
          'relative flex flex-col gap-[12px]',
          !on && 'opacity-50'
        )}
      >
        {locked && (
          <button
            type="button"
            onClick={() => openPlus()}
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 z-[1] cursor-pointer"
          />
        )}
        <div className="flex items-center flex-wrap gap-[8px] text-[14px]">
          <span>{t('wallet_auto_when_below', 'When balance falls below')}</span>
          <span className="inline-flex items-center h-[36px] bg-newBgColorInner border border-newTableBorder rounded-[8px] hover:border-newSep focus-within:border-btnPrimary">
            <input
              dir="ltr"
              inputMode="decimal"
              disabled={!on || !canEdit}
              value={form.threshold}
              aria-label={t('wallet_auto_threshold', 'Threshold in credits')}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  threshold: f.creditsInput(e.target.value),
                }))
              }
              className="w-[84px] h-full bg-transparent ps-[12px] text-[14px] font-[600] tabular-nums outline-none"
            />
            <span className="pe-[12px] text-textItemBlur text-[13px]">
              {t('wallet_credits', 'credits')}
            </span>
          </span>
          <span>{t('wallet_auto_add', ', add')}</span>
          <SelectBox
            label={t('wallet_auto_amount', 'Top-up amount')}
            value={form.amount}
            options={amountOptions.filter((v) => v >= minAmount)}
            disabled={!on || !canEdit}
            render={f.moneyShort}
            onChange={(amount) =>
              setForm((s) => ({ ...s, amount, cap: Math.max(s.cap, amount) }))
            }
          />
        </div>
        <div className="flex items-center flex-wrap gap-[8px] text-[14px]">
          <span>
            {t('wallet_auto_monthly_limit', 'Monthly spending limit')}
          </span>
          <SelectBox
            label={t('wallet_auto_monthly_limit', 'Monthly spending limit')}
            value={Math.max(form.cap, form.amount)}
            options={capOptions}
            disabled={!on || !canEdit}
            render={f.moneyShort}
            onChange={(c) => setForm((s) => ({ ...s, cap: c }))}
          />
          <InfoTip
            text={t(
              'wallet_auto_limit_info',
              "The most auto top-up can charge your card in a calendar month. Manual top-ups don't count towards it."
            )}
          />
        </div>
      </div>
      {paid && (
        <>
          {!!wallet.card && (
            <div className="flex items-center flex-wrap gap-[12px] p-[12px] rounded-[8px] bg-newTableHeader">
              <CardIcon />
              <div className="flex-1 min-w-0 text-[14px]">
                <span className="font-[600]">{cardLabel(wallet.card)}</span>
                {!!wallet.card.exp && (
                  <span className="text-textItemBlur ms-[6px] tabular-nums">
                    {t('wallet_card_expires', 'Expires {{exp}}', {
                      exp: wallet.card.exp,
                      interpolation: { escapeValue: false },
                    })}
                  </span>
                )}
              </div>
              {isAdmin && !wallet.frozen && (
                <button
                  type="button"
                  disabled={changingCard}
                  onClick={() => changeCard()}
                  className="text-[13px] text-textItemBlur hover:text-newTextColor underline underline-offset-2 disabled:opacity-50"
                >
                  {t('wallet_card_change', 'Change')}
                </button>
              )}
            </div>
          )}
          <div className={clsx('flex flex-col gap-[8px]', !on && 'opacity-50')}>
            <div className="flex items-center justify-between flex-wrap gap-[8px] text-[13px]">
              <span className="text-textItemBlur">
                {t('wallet_auto_used', 'Auto top-up used this month')}
              </span>
              <span className="tabular-nums">
                <span className="font-[600]">{f.money(used)}</span>{' '}
                <span className="text-textItemBlur">
                  {t('wallet_of_amount', 'of {{amount}}', {
                    amount: f.money(cap),
                  })}
                </span>
              </span>
            </div>
            <div className="h-[6px] rounded-full bg-newBgLineColor overflow-hidden">
              <div
                className="h-full rounded-full bg-btnPrimary"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-[12px] text-textItemBlur">
              {on ? (
                <span className="inline-flex items-center gap-[6px]">
                  <span>
                    {t('wallet_auto_resets', 'Resets on {{date}}.', {
                      date: f.dayMonth(
                        new Date(
                          Date.UTC(resets.getFullYear(), resets.getMonth(), 1)
                        )
                      ),
                    })}
                  </span>
                  <InfoTip
                    size={14}
                    text={t(
                      'wallet_auto_limit_pause',
                      'At the limit, auto top-up pauses until you top up by hand.'
                    )}
                  />
                </span>
              ) : (
                t(
                  'wallet_auto_off_warning',
                  "Off. Anything that needs more credits than you have won't go out."
                )
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!on || saving}
                onClick={() =>
                  save(true, t('wallet_auto_saved', 'Auto top-up saved'))
                }
                className={clsx(BTN_SIMPLE, '!h-[36px] !text-[14px]')}
              >
                {t('wallet_save_changes', 'Save changes')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Rounds a chart's top up to a readable value (1, 2, 2.5 or 5 x 10^n).
const niceTop = (max: number) => {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * p >= max) || 10;
  return step * p;
};

const DAY_OPTIONS = [7, 30, 90];

const UsageTab: FC<{ f: WalletFormat }> = ({ f }) => {
  const t = useT();
  const [days, setDays] = useState(30);
  // Read on every plan: welcome credits are spent too (images, voice-overs).
  const { data, isLoading } = useWalletUsage(days);
  const find = usePriceLookup();

  // Every day of the window, oldest first, with no gaps (UTC days, as the
  // server groups them).
  const series = useMemo(() => {
    const totals = new Map((data?.byDay || []).map((d) => [d.day, d.total]));
    const today = new Date();
    return Array.from({ length: days }, (_, i) => {
      const date = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - (days - 1 - i)
        )
      );
      const key = date.toISOString().slice(0, 10);
      return { date, total: totals.get(key) || 0 };
    });
  }, [data, days]);

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-[40px]">
        <Spinner />
      </div>
    );
  }

  const rows = (data?.byAction || []).map((r) => {
    const a = r.key ? find(r.key) : undefined;
    return {
      ...r,
      provider: a?.provider || null,
      label: a ? actionName(t, a) : r.name || r.key || '',
      unitPrice: a ? a.price : null,
    };
  });
  const total = rows.reduce((s, r) => s + r.total, 0);
  const quantity = rows.reduce((s, r) => s + r.quantity, 0);
  const daySelect = (
    <span className="relative inline-flex">
      <select
        aria-label={t('wallet_usage_period', 'Period')}
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        className="appearance-none h-[32px] ps-[12px] pe-[28px] rounded-[8px] border border-newTableBorder bg-newBgColorInner text-[13px] hover:border-newSep cursor-pointer outline-none"
      >
        {DAY_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {t('wallet_last_days', 'Last {{days}} days', { days: d })}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute end-[10px] top-1/2 -translate-y-1/2 text-textItemBlur">
        <ChevronIcon />
      </span>
    </span>
  );

  if (!rows.length) {
    return (
      <>
        <div className="flex justify-end">{daySelect}</div>
        <EmptyState
          title={t('wallet_no_usage', 'No usage yet')}
          body={t(
            'wallet_no_usage_any',
            'Anything you spend credits on, like an image or a voice-over, shows here with its cost, by day.'
          )}
        />
      </>
    );
  }

  const max = Math.max(...series.map((d) => d.total));
  const top = niceTop(max / 100) * 100;
  const last = series.length - 1;
  const ticks = [
    0,
    Math.floor(last / 4),
    Math.floor(last / 2),
    Math.floor((last * 3) / 4),
    last,
  ];
  const tiles: [string, string, string][] = [
    [
      t('wallet_spent', 'Spent'),
      f.credits(total),
      t('wallet_credits', 'credits'),
    ],
    [
      t('wallet_paid_actions', 'Paid actions'),
      f.number(quantity),
      t('wallet_paid_actions_sub', 'across pay-per-use features'),
    ],
    [
      t('wallet_average_day', 'Average per day'),
      f.credits(Math.round(total / days)),
      t('wallet_credits', 'credits'),
    ],
  ];

  return (
    <>
      <div className="grid gap-[12px] grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {tiles.map(([a, b, c]) => (
          <div key={a} className={clsx(CARD, 'p-[18px] min-w-0')}>
            <div className="text-[13px] text-textItemBlur">{a}</div>
            <div className="text-[26px] font-[600] tabular-nums mt-[6px] truncate">
              {b}
            </div>
            <div className="text-[12px] text-textItemBlur mt-[2px]">{c}</div>
          </div>
        ))}
      </div>
      <div className={clsx(CARD, 'p-[20px] min-w-0')}>
        <div className="flex items-center justify-between gap-[12px] flex-wrap mb-[16px]">
          <div className="text-[15px] font-[600]">
            {t('wallet_credits_per_day', 'Credits per day')}
          </div>
          <div className="text-[13px] text-textItemBlur">
            {t('wallet_date_range', '{{from}} to {{to}}', {
              from: f.dayMonth(series[0].date),
              to: f.dayMonthYear(series[last].date),
            })}
          </div>
        </div>
        <div className="flex gap-[10px]">
          <div className="flex flex-col justify-between text-[11px] text-textItemBlur tabular-nums h-[180px] text-end w-[52px] shrink-0">
            <span>{f.credits(top)}</span>
            <span>{f.credits(top / 2)}</span>
            <span>0</span>
          </div>
          <div className="flex-1 relative h-[180px] min-w-0">
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <div className="border-t border-dashed border-newTableBorder" />
              <div className="border-t border-dashed border-newTableBorder" />
              <div className="border-t border-newTableBorder" />
            </div>
            <div className="absolute inset-0 flex items-end gap-[clamp(1px,0.3vw,6px)]">
              {series.map((d) => (
                <div
                  key={d.date.toISOString()}
                  className="flex-1 h-full flex items-end group"
                  data-tooltip-id="tooltip"
                  data-tooltip-content={t(
                    'wallet_day_tooltip',
                    '{{day}}: {{credits}} credits',
                    {
                      day: f.dayMonth(d.date),
                      credits: f.credits(d.total),
                    }
                  )}
                >
                  <div
                    className="w-full rounded-t-[3px] bg-btnPrimary opacity-70 group-hover:opacity-100 group-hover:bg-ai transition-colors"
                    style={{ height: `${(d.total / top) * 100}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-between ps-[62px] mt-[8px] text-[11px] text-textItemBlur">
          {ticks.map((i, n) => (
            <span key={`${i}-${n}`}>{f.dayMonth(series[i].date)}</span>
          ))}
        </div>
      </div>
      <div className={clsx(CARD, 'overflow-hidden min-w-0')}>
        <div className="flex items-center justify-between gap-[12px] px-[20px] h-[56px]">
          <div className="text-[15px] font-[600]">
            {t('wallet_breakdown', 'Breakdown')}
          </div>
          {daySelect}
        </div>
        <div className={clsx('overflow-x-auto', SCROLL)}>
          <table className="w-full min-w-[560px] text-[14px]">
            <thead>
              <tr className="bg-newTableHeader text-[12px] text-textItemBlur h-[40px]">
                <th className="text-start font-[500] px-[20px]">
                  {t('wallet_col_action', 'Action')}
                </th>
                <th className="text-end font-[500] px-[20px]">
                  {t('wallet_col_unit_price', 'Unit price')}
                </th>
                <th className="text-end font-[500] px-[20px]">
                  {t('wallet_col_quantity', 'Quantity')}
                </th>
                <th className="text-end font-[500] px-[20px]">
                  {t('wallet_col_credits', 'Credits')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key || r.label}
                  className="border-t border-newTableBorder h-[52px] hover:bg-boxHover"
                >
                  <td className="px-[20px]">
                    <div className="flex items-center gap-[10px]">
                      {!!r.provider && <ProviderLogo provider={r.provider} />}
                      {r.label}
                    </div>
                  </td>
                  <td className="px-[20px] text-end tabular-nums text-textItemBlur">
                    {r.unitPrice === null ? '' : f.credits(r.unitPrice)}
                  </td>
                  <td className="px-[20px] text-end tabular-nums">
                    {f.number(r.quantity)}
                  </td>
                  <td className="px-[20px] text-end tabular-nums font-[600]">
                    {f.credits(r.total)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-newTableBorder h-[52px] bg-newTableHeader">
                <td className="px-[20px] font-[600]" colSpan={3}>
                  {t('wallet_total', 'Total')}
                </td>
                <td className="px-[20px] text-end tabular-nums font-[700]">
                  {f.credits(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

const TYPE_STYLE: Record<string, string> = {
  TOPUP: clsx(TEAL_SOFT, TEAL_TEXT),
  AUTO_TOPUP: clsx(TEAL_SOFT, TEAL_TEXT),
  SPEND: 'bg-newBgLineColor text-textItemBlur',
  REFUND: clsx(POS_SOFT, POS_TEXT),
  GRANT: clsx(POS_SOFT, POS_TEXT),
  ADJUST: 'bg-warmSoft text-warm',
  PLAN_GRANT: 'bg-warmSoft text-warm',
  PLAN_EXPIRE: 'bg-newBgLineColor text-textItemBlur',
};

const PAGE_SIZE = 10;

// The type filter: tab key -> the API's ?type= value.
const TX_FILTERS: Record<string, string> = {
  all: '',
  topups: 'TOPUP,AUTO_TOPUP',
  spend: 'SPEND',
  refunds: 'REFUND',
};

// Page numbers to show: the first, the last and two either side of the
// current one, with gaps as null.
const pageWindow = (page: number, pages: number) => {
  const out: (number | null)[] = [];
  for (let n = 0; n < pages; n++) {
    if (n === 0 || n === pages - 1 || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
};

const TransactionsTab: FC<{ wallet: WalletSummary; f: WalletFormat }> = ({
  wallet,
  f,
}) => {
  const t = useT();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('all');
  const { data, isLoading } = useWalletTransactions(
    page,
    PAGE_SIZE,
    true,
    TX_FILTERS[filter]
  );
  const find = usePriceLookup();
  const filters = (
    <div className="flex items-center justify-between gap-[12px] flex-wrap">
      <Segmented
        items={[
          ['all', t('wallet_tx_filter_all', 'All')],
          ['topups', t('wallet_tx_filter_topups', 'Top-ups')],
          ['spend', t('wallet_tx_filter_spend', 'Spend')],
          ['refunds', t('wallet_tx_filter_refunds', 'Refunds')],
        ]}
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setPage(0);
        }}
      />
    </div>
  );

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-[40px]">
        <Spinner />
      </div>
    );
  }
  if (!data?.total) {
    // With no filter there is nothing at all; a filter keeps its tabs.
    return (
      <>
        {filter !== 'all' && filters}
        <EmptyState
          title={t('wallet_no_transactions', 'No transactions yet')}
          body={t(
            'wallet_no_transactions_body',
            'Top-ups, spend and refunds will show here.'
          )}
        />
      </>
    );
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const from = page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, data.total);

  return (
    <>
      {filters}
      <div className={clsx(CARD, 'overflow-hidden min-w-0')}>
        <div className={clsx('overflow-x-auto', SCROLL)}>
          <table className="w-full min-w-[700px] text-[14px]">
            <thead>
              <tr className="bg-newTableHeader text-[12px] text-textItemBlur h-[40px]">
                <th className="text-start font-[500] px-[20px]">
                  {t('wallet_col_name', 'Name')}
                </th>
                <th className="text-start font-[500] px-[20px]">
                  {t('wallet_col_type', 'Type')}
                </th>
                <th className="text-end font-[500] px-[20px]">
                  {t('wallet_col_credits', 'Credits')}
                </th>
                <th className="text-start font-[500] px-[20px]">
                  {t('wallet_col_date', 'Date')}
                </th>
                <th className="px-[20px] w-[100px]">
                  <span className="sr-only">
                    {t('wallet_col_receipt', 'Receipt')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((tx) => {
                const pos = tx.amount > 0;
                return (
                  <tr
                    key={tx.id}
                    className="border-t border-newTableBorder h-[56px] hover:bg-boxHover"
                  >
                    <td className="px-[20px] py-[8px]">
                      <div className="font-[600]">{txName(t, tx, find)}</div>
                      {!!tx.description && (
                        <div className="text-[12px] text-textItemBlur">
                          {tx.description}
                        </div>
                      )}
                    </td>
                    <td className="px-[20px]">
                      <span
                        className={clsx(
                          PILL,
                          TYPE_STYLE[tx.type] ||
                            'bg-newBgLineColor text-textItemBlur'
                        )}
                      >
                        {txTypeLabel(t, tx.type)}
                      </span>
                    </td>
                    <td
                      className={clsx(
                        'px-[20px] text-end font-[600]',
                        pos && POS_TEXT
                      )}
                    >
                      <Num>
                        {pos ? '+' : '−'}
                        {f.credits(Math.abs(tx.amount))}
                      </Num>
                    </td>
                    <td className="px-[20px] text-textItemBlur tabular-nums whitespace-nowrap">
                      {f.dateTime(tx.createdAt)}
                    </td>
                    <td className="px-[20px] text-end">
                      {!!tx.receiptUrl && (
                        <a
                          href={tx.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-textItemBlur hover:text-newTextColor underline underline-offset-2"
                        >
                          {t('wallet_receipt', 'Receipt')}
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-[12px] flex-wrap px-[20px] py-[12px] min-h-[56px] border-t border-newTableBorder text-[13px]">
          <span className="text-textItemBlur">
            {t('wallet_showing', 'Showing {{from}} to {{to}} of {{total}}', {
              from: f.number(from),
              to: f.number(to),
              total: f.number(data.total),
            })}
          </span>
          <div className="flex items-center flex-wrap gap-[4px]">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="h-[32px] px-[10px] rounded-[6px] border border-newTableBorder hover:bg-boxHover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('wallet_previous', 'Previous')}
            </button>
            {pageWindow(page, pages).map((n, i) =>
              n === null ? (
                <span key={`gap-${i}`} className="px-[4px] text-textItemBlur">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-label={t('wallet_page_n', 'Page {{n}}', { n: n + 1 })}
                  aria-current={n === page ? 'page' : undefined}
                  onClick={() => setPage(n)}
                  className={clsx(
                    'h-[32px] min-w-[32px] px-[6px] rounded-[6px] tabular-nums',
                    n === page
                      ? 'bg-boxFocused text-textItemFocused font-[600]'
                      : 'hover:bg-boxHover text-textItemBlur'
                  )}
                >
                  {f.number(n + 1)}
                </button>
              )
            )}
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="h-[32px] px-[10px] rounded-[6px] border border-newTableBorder hover:bg-boxHover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('wallet_next', 'Next')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

// `center`: the column sits in the middle of the page (the Plus page).
const PageShell: FC<{ children: ReactNode; max: number; center?: boolean }> = ({
  children,
  max,
  center,
}) => (
  <div className="bg-newBgColorInner flex-1 min-w-0">
    <div
      className={clsx(
        'p-[20px] flex flex-col gap-[20px] w-full',
        center && 'mx-auto py-[32px] mobile:px-[16px] mobile:py-[20px]'
      )}
      style={{ maxWidth: max }}
    >
      {children}
    </div>
  </div>
);
export { PageShell as WalletPageShell };

// The Billing page: balance, auto top-up, usage and transactions.
export const WalletBillingPage: FC = () => {
  const hasWallet = useHasWallet();
  return hasWallet ? <WalletBilling /> : <NoWallet />;
};

const WalletBilling: FC = () => {
  const t = useT();
  useTrackView('wallet_opened');
  const params = useSearchParams();
  const { data: wallet, error } = useWallet(true);
  const f = useWalletFormat(wallet?.currency);
  const [tab, setTab] = useState(
    params.get('tab') === 'transactions' ? 'transactions' : 'usage'
  );

  useEffect(() => {
    const p = params.get('tab');
    if (p === 'transactions' || p === 'usage') setTab(p);
  }, [params]);

  return (
    <>
      <WalletCheckoutReturn />
      {!wallet ? (
        error ? (
          <div className="flex-1 bg-newBgColorInner flex items-center justify-center text-textItemBlur text-[14px] p-[20px]">
            {t('wallet_unavailable', 'The wallet is not available right now.')}
          </div>
        ) : (
          <Loading />
        )
      ) : (
        <PageShell max={1600}>
          <div className="grid gap-[12px] grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))]">
            <BalanceCard
              wallet={wallet}
              f={f}
              showTransactions={() => setTab('transactions')}
            />
            <AutoTopUpCard
              // Starts the form again whenever the saved settings change.
              key={[
                wallet.payAsYouGo,
                wallet.topUpAllowed,
                wallet.autoTopUp.enabled,
                wallet.autoTopUp.threshold,
                wallet.autoTopUp.amount,
                wallet.autoTopUp.monthlyCap,
                wallet.card?.last4,
                wallet.card?.exp,
              ].join('|')}
              wallet={wallet}
              f={f}
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-[12px] mt-[8px]">
            <Segmented
              items={[
                ['usage', t('wallet_usage', 'Usage')],
                ['transactions', t('wallet_transactions', 'Transactions')],
              ]}
              value={tab}
              onChange={setTab}
            />
            <Link
              href="/wallet/prices"
              className="flex items-center gap-[8px] text-[14px] text-textItemBlur hover:text-newTextColor"
            >
              {t('wallet_view_prices', 'View prices')} <ArrowIcon />
            </Link>
          </div>
          <div className="flex flex-col gap-[12px]">
            {tab === 'transactions' ? (
              <TransactionsTab wallet={wallet} f={f} />
            ) : (
              <UsageTab f={f} />
            )}
          </div>
        </PageShell>
      )}
    </>
  );
};
