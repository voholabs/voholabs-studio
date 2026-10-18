'use client';

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useWalletFormat } from '@gitroom/frontend/components/wallet/wallet.hooks';
import {
  ArrowIcon,
  BTN_PRIMARY,
  BTN_SIMPLE,
  CARD,
  CheckIcon,
  CoinsIcon,
  Num,
  PILL_TEAL,
  Spinner,
} from '@gitroom/frontend/components/wallet/wallet.ui';
import { CopyIcon, TagIcon } from '@gitroom/frontend/components/ui/icons';
import { useCountdown } from '@gitroom/frontend/components/plus/plus.countdown';
import {
  PlusEarlyBird,
  PlusInterval,
  PlusIntervalKey,
  PlusOffer,
  PlusPlan,
} from '@gitroom/frontend/components/plus/plus.types';

const raw = { interpolation: { escapeValue: false } };

// Plus speaks in the teal brand accent on every surface that sells it (the
// page, the dialog, /pricing, the onboarding offer and the banner): one
// accent family, the same as the primary button. The early-bird code (the
// strip, the chip, the countdown and the banner) is in the warm gold, the
// same as the locks (TONE_TEXT.warm, TONE_SOFT.warm), so it stands out from
// the plan cards.
export const PILL_PLUS = PILL_TEAL;
export const EARLY_BIRD_TEXT = 'text-warm';
export const EARLY_BIRD_SOFT = 'bg-warmSoft';
const BADGE =
  'inline-flex items-center h-[24px] px-[10px] rounded-full text-[12px] font-[700] whitespace-nowrap tabular-nums';
const BADGE_SOLID = clsx(BADGE, 'bg-btnPrimary text-white');
const BADGE_SOFT = clsx(BADGE, 'bg-tealSoft text-tealText');

// The countdown text, ticking every second. Tabular digits so it does not
// jitter; no animation, so reduced motion needs nothing more.
export const EarlyBirdTimer: FC<{
  expiresAt: string;
  offsetMs: number;
  onExpire?: () => void;
  className?: string;
}> = ({ expiresAt, offsetMs, onExpire, className }) => {
  const { text } = useCountdown(expiresAt, offsetMs, onExpire);
  return (
    <span
      dir="ltr"
      role="timer"
      className={clsx('inline-block tabular-nums font-[700]', className)}
    >
      {text}
    </span>
  );
};

// A star, for Plus.
export const PlusBadgeIcon: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7L12 3z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

// The workspace's early-bird code with a copy button. Compact (icon only)
// for the banner and the strip.
export const EarlyBirdCode: FC<{ code: string; compact?: boolean }> = ({
  code,
  compact,
}) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onCopy = () => {
    if (!copy(code)) {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  const label = t('plus_code_copy', 'Copy code');
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-[4px] rounded-[6px] border border-dashed border-warm bg-newBgColorInner ps-[8px] pe-[2px]',
        compact ? 'h-[26px] mobile:h-[32px]' : 'h-[32px]'
      )}
    >
      <code
        dir="ltr"
        className={clsx(
          'font-mono font-[700] tracking-[0.06em] text-newTextColor',
          compact ? 'text-[12px]' : 'text-[15px]'
        )}
      >
        {code}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={label}
        title={label}
        className={clsx(
          'flex items-center justify-center gap-[4px] rounded-[4px] px-[6px] font-[600] hover:bg-warmHover transition-colors',
          EARLY_BIRD_TEXT,
          compact ? 'h-[22px] min-w-[24px] mobile:h-[28px] mobile:min-w-[28px]' : 'h-[26px] text-[12px]'
        )}
      >
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={14} />}
        {!compact && (
          <span aria-hidden="true">
            {copied ? t('plus_code_copied', 'Copied') : label}
          </span>
        )}
      </button>
      <span role="status" className="sr-only">
        {copied ? t('plus_code_copied_status', 'Code copied') : ''}
      </span>
    </span>
  );
};

// The early bird as one slim strip: what the code takes off, the code to
// copy and the time left. Checkout applies it already; typed there, it
// works too.
const EarlyBirdStrip: FC<{
  earlyBird: PlusEarlyBird;
  timer: string;
  className?: string;
}> = ({ earlyBird, timer, className }) => {
  const t = useT();
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center justify-center gap-x-[12px] gap-y-[6px] rounded-[12px] border border-warmRing px-[14px] py-[8px] text-[13px] text-center',
        EARLY_BIRD_SOFT,
        className
      )}
    >
      <span
        className={clsx('flex items-center gap-[6px] font-[700]', EARLY_BIRD_TEXT)}
      >
        <TagIcon className="w-[14px] h-[14px] shrink-0" aria-hidden="true" />
        {t('plus_code_strip', '{{percent}}% off your first payment', {
          percent: earlyBird.percent,
        })}
      </span>
      <EarlyBirdCode code={earlyBird.code} compact={true} />
      <span className="text-newTextColor">
        {t('plus_early_bird_ends_in_cap', 'Ends in')}{' '}
        <span
          dir="ltr"
          role="timer"
          className={clsx('tabular-nums font-[700]', EARLY_BIRD_TEXT)}
        >
          {timer}
        </span>
      </span>
      <span className="text-[12px] text-textItemBlur">
        {t('plus_code_applied_short', 'Applied at checkout')}
      </span>
    </div>
  );
};

// What each credit release costs on the plan, and the same credits as
// top-ups: a month's worth, also on the annual plan (its price over its
// releases).
const perRelease = (i: PlusInterval) => ({
  price: i.pricePerRelease,
  topUp: Math.round(i.topUpPrice / Math.max(1, i.releases)),
});

// The first payment with the early-bird code.
const withCode = (price: number, percent: number) =>
  Math.round((price * (100 - percent)) / 100);

// Whole credits one unit of the currency buys on the plan (rounded down,
// never more than it gives).
const planCreditsPerUnit = (
  offer: PlusOffer,
  i: PlusInterval,
  factor: number
) =>
  i.pricePerRelease > 0
    ? Math.floor((offer.creditsPerPeriod * factor) / i.pricePerRelease)
    : 0;

// "$1 = 19 credits": what a top-up buys. From the offer's rate.
const TopUpRate: FC<{ offer: PlusOffer; className?: string }> = ({
  offer,
  className,
}) => {
  const t = useT();
  const f = useWalletFormat(offer.currency);
  return (
    <span className={clsx('tabular-nums', className)}>
      {t('plus_topup_rate', 'Top-ups: {{money}} = {{credits}} credits', {
        money: f.moneyShort(f.factor),
        credits: f.number(offer.topUpCreditsPerUnit),
        ...raw,
      })}
    </span>
  );
};

// The plan price against the same credits bought as top-ups: the top-up
// cost struck through, the plan price, and how much cheaper it is. All from
// the offer (the settings). Small, for the onboarding offer.
const PlusPriceVsTopUps: FC<{
  offer: PlusOffer;
  interval: PlusInterval;
}> = ({ offer, interval }) => {
  const t = useT();
  const f = useWalletFormat(offer.currency);
  const perLabel =
    interval.interval === 'year'
      ? t('plus_per_year', '/ year')
      : t('plus_per_month', '/ month');
  const cheaper = interval.savingPercent > 0;
  return (
    <span className="flex items-baseline flex-wrap gap-x-[8px] gap-y-[4px] tabular-nums text-[14px]">
      {cheaper && (
        <s className="text-textItemBlur decoration-[1.5px]">
          <span className="sr-only">{t('plus_topups_cost', 'As top-ups:')} </span>
          <span dir="ltr">{f.moneyShort(interval.topUpPrice)}</span>
        </s>
      )}
      <span className="font-[700]">
        <Num>{f.moneyShort(interval.price)}</Num>
      </span>
      <span className="text-textItemBlur text-[13px]">{perLabel}</span>
      {cheaper && (
        <span className="text-[12px] font-[700] text-tealText">
          {t('plus_cheaper', '{{n}}% cheaper than top-ups', {
            n: interval.savingPercent,
          })}
        </span>
      )}
    </span>
  );
};

// One plan as a card: the saving as a badge, the top-up price struck
// through, the price a month, the button, and the credits it brings
// against top-ups.
const PlanCard: FC<{
  offer: PlusOffer;
  interval: PlusInterval;
  highlight: boolean;
  codePercent: number | null;
  onSubscribe?: (interval: PlusIntervalKey) => void;
  subscribeHref?: string;
  busy?: boolean;
}> = ({
  offer,
  interval,
  highlight,
  codePercent,
  onSubscribe,
  subscribeHref,
  busy,
}) => {
  const t = useT();
  const f = useWalletFormat(offer.currency);
  const year = interval.interval === 'year';
  const m = perRelease(interval);
  const cheaper = interval.savingPercent > 0;
  const name = year ? t('plus_annual', 'Annual') : t('plus_monthly', 'Monthly');
  const rate = planCreditsPerUnit(offer, interval, f.factor);
  const cta = (
    <>
      {busy ? <Spinner size={18} /> : <PlusBadgeIcon size={16} />}
      {year
        ? t('plus_subscribe_year', 'Get Plus annual')
        : t('plus_subscribe_month', 'Get Plus monthly')}
    </>
  );
  const buttonClass = clsx(highlight ? BTN_PRIMARY : BTN_SIMPLE, 'w-full');
  return (
    <div
      className={clsx(
        CARD,
        'flex flex-col gap-[16px] p-[20px] mobile:p-[16px] min-w-0 bg-newBgColorInner',
        highlight && 'border-btnPrimary shadow-[0_0_0_1px_var(--new-btn-primary)]'
      )}
    >
      <div className="flex items-center justify-between gap-[8px] min-h-[24px]">
        <div className="text-[16px] font-[700]">{name}</div>
        {cheaper && (
          <span
            className={highlight ? BADGE_SOLID : BADGE_SOFT}
          >
            {t('plus_save_badge', '{{n}}% under top-ups', { n: interval.savingPercent })}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="flex items-baseline flex-wrap gap-x-[8px] gap-y-[2px] tabular-nums">
          {cheaper && (
            <s className="text-[20px] text-textItemBlur decoration-[2px]">
              <span className="sr-only">
                {t('plus_topups_cost', 'As top-ups:')}{' '}
              </span>
              <span dir="ltr">{f.moneyShort(m.topUp)}</span>
            </s>
          )}
          <span className="text-[40px] mobile:text-[34px] font-[600] leading-none">
            <Num>{f.moneyShort(m.price)}</Num>
          </span>
          <span className="text-[14px] text-textItemBlur">
            {t('plus_per_month', '/ month')}
          </span>
        </div>
        <div className="text-[13px] text-textItemBlur tabular-nums">
          {year
            ? t('plus_billed_year', 'Billed {{money}} a year', {
                money: f.moneyShort(interval.price),
                ...raw,
              })
            : t('plus_billed_month', 'Billed monthly')}
        </div>
      </div>
      {subscribeHref ? (
        <Link href={subscribeHref} className={buttonClass}>
          {cta}
        </Link>
      ) : onSubscribe ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubscribe(interval.interval)}
          className={buttonClass}
        >
          {cta}
        </button>
      ) : null}
      {codePercent !== null && (
        <div className="text-[13px] font-[600] text-tealText tabular-nums -mt-[6px] text-center">
          {t('plus_first_payment_code', 'First payment {{money}} with your code', {
            money: f.moneyShort(withCode(interval.price, codePercent)),
            ...raw,
          })}
        </div>
      )}
      <div className="flex gap-[10px] items-start rounded-[10px] bg-newTableHeader p-[12px]">
        <span className="mt-[2px] text-tealText">
          <CoinsIcon size={16} />
        </span>
        <div className="flex flex-col gap-[2px] min-w-0">
          <div className="text-[15px] font-[600] tabular-nums">
            {t('plus_card_credits', '{{credits}} credits a month', {
              credits: f.number(offer.creditsPerPeriod),
            })}
          </div>
          {cheaper && (
            <div className="text-[12px] text-textItemBlur tabular-nums">
              {t(
                'plus_card_credits_topups',
                '{{money}} as top-ups, at {{unit}} = {{credits}} credits',
                {
                  money: f.moneyShort(m.topUp),
                  unit: f.moneyShort(f.factor),
                  credits: f.number(offer.topUpCreditsPerUnit),
                  ...raw,
                }
              )}
            </div>
          )}
          {rate > 0 && (
            <div className="text-[12px] font-[600] text-tealText tabular-nums">
              {t('plus_card_rate', 'On Plus: {{unit}} = {{credits}} credits', {
                unit: f.moneyShort(f.factor),
                credits: f.number(rate),
                ...raw,
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// The Plus offer: Monthly and Annual side by side, each against the same
// credits as top-ups, the early-bird code as a strip with its countdown,
// and what every plan includes once below. Presentational: the caller says
// what Subscribe does (a button, or a link for visitors).
export const PlusOfferCard: FC<{
  offer: PlusOffer;
  earlyBird?: PlusEarlyBird | null;
  offsetMs?: number;
  // Read the plan again when the countdown runs out.
  onExpire?: () => void;
  onSubscribe?: (interval: PlusIntervalKey) => void;
  subscribeHref?: string;
  busy?: boolean;
  // Why this was opened, e.g. the lock that sent the person here.
  context?: string;
  // The centred headline, for the page and /pricing (not the dialog).
  hero?: boolean;
  // Where "View prices" goes; none on /pricing (the list follows).
  pricesHref?: string;
  className?: string;
}> = ({
  offer,
  earlyBird,
  offsetMs = 0,
  onExpire,
  onSubscribe,
  subscribeHref,
  busy,
  context,
  hero,
  pricesHref,
  className,
}) => {
  const t = useT();
  const intervals = useMemo(
    () =>
      (['month', 'year'] as PlusIntervalKey[])
        .map((k) => offer.intervals.find((i) => i.interval === k))
        .filter((i): i is PlusInterval => !!i),
    [offer]
  );
  const { live, text } = useCountdown(
    earlyBird?.expiresAt,
    offsetMs,
    onExpire
  );
  if (!intervals.length) {
    return null;
  }
  const best = intervals.reduce((a, b) =>
    b.savingPercent > a.savingPercent ? b : a
  );
  const codePercent = live && earlyBird ? earlyBird.percent : null;
  const features = [
    t('plus_feat_unlocks', 'X posting and research data'),
    t('plus_feat_paid', 'Every paid feature open'),
    t('plus_feat_topups', 'Top up any time; top-ups never expire'),
    t('plus_feat_reset', 'Plan credits renew every {{days}} days', {
      days: offer.periodDays,
    }),
    t('plus_feat_rollover', "Unused plan credits don't roll over"),
    t('plus_feat_cancel', 'Cancel any time'),
  ];

  return (
    <div className={clsx('flex flex-col gap-[20px] min-w-0', className)}>
      {hero && (
        <h2 className="text-[30px] mobile:text-[24px] leading-[1.15] font-[600] text-center max-w-[780px] self-center">
          {best.savingPercent > 0
            ? t('plus_hero_saving', 'Plus: every feature open and credits up to {{n}}% cheaper', {
                n: best.savingPercent,
              })
            : t('plus_hero', 'Plus: every feature open and credits every month')}
        </h2>
      )}
      {!!context && (
        <div className="text-[14px] leading-[1.5] text-newTextColor/80 text-center">
          {context}
        </div>
      )}
      {codePercent !== null && !!earlyBird && (
        <EarlyBirdStrip
          earlyBird={earlyBird}
          timer={text}
          className="self-center"
        />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[16px]">
        {intervals.map((i) => (
          <PlanCard
            key={i.interval}
            offer={offer}
            interval={i}
            highlight={intervals.length > 1 && i === best}
            codePercent={codePercent}
            onSubscribe={onSubscribe}
            subscribeHref={subscribeHref}
            busy={busy}
          />
        ))}
      </div>
      <div className="flex flex-col gap-[10px]">
        <div className="text-[13px] font-[600] text-textItemBlur">
          {t('plus_every_plan', 'Every Plus plan includes')}
        </div>
        <ul className="grid grid-cols-2 mobile:grid-cols-1 gap-x-[20px] gap-y-[8px]">
          {features.map((b) => (
            <li key={b} className="flex gap-[8px] items-start text-[14px] leading-[1.45]">
              <span className="mt-[2px] text-tealText shrink-0">
                <CheckIcon size={14} />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px] border-t border-newTableBorder pt-[14px] text-[13px] text-textItemBlur">
        <span className="flex items-center gap-[6px]">
          <CoinsIcon size={14} />
          <TopUpRate offer={offer} />
        </span>
        {!!pricesHref && (
          <Link
            href={pricesHref}
            className="flex items-center gap-[6px] hover:text-newTextColor"
          >
            {t('wallet_view_prices', 'View prices')} <ArrowIcon />
          </Link>
        )}
      </div>
    </div>
  );
};

// The plan credits and the top-up credits, side by side.
export const PlusCredits: FC<{
  credits: Pick<PlusPlan['credits'], 'plan' | 'topUp' | 'planResetsAt'>;
  currency?: string;
}> = ({ credits, currency }) => {
  const t = useT();
  const f = useWalletFormat(currency);
  return (
    <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[8px]">
      <div className="rounded-[10px] bg-newTableHeader p-[12px] flex flex-col gap-[2px]">
        <div className="text-[12px] text-textItemBlur">
          {t('plus_plan_credits', 'Plan credits')}
        </div>
        <div className="text-[18px] font-[600] tabular-nums">
          <Num>{f.credits(credits.plan)}</Num>
        </div>
        {!!credits.planResetsAt && (
          <div className="text-[12px] text-textItemBlur">
            {t('plus_resets_on', 'Resets on {{date}}', {
              date: f.dayMonthYear(new Date(credits.planResetsAt)),
            })}
          </div>
        )}
      </div>
      <div className="rounded-[10px] bg-newTableHeader p-[12px] flex flex-col gap-[2px]">
        <div className="text-[12px] text-textItemBlur">
          {t('plus_topup_credits', 'Top-up credits')}
        </div>
        <div className="text-[18px] font-[600] tabular-nums">
          <Num>{f.credits(credits.topUp)}</Num>
        </div>
        <div className="text-[12px] text-textItemBlur">
          {t('plus_topup_never_expire', 'Never expire')}
        </div>
      </div>
    </div>
  );
};


// The early bird in a box, for screens that are not about Plus (the end of
// onboarding): the code strip with the time left, each plan against
// top-ups, the top-up rate and a way to Plus. Nothing once the time is up or
// when there is no offer.
export const EarlyBirdOfferBox: FC<{
  offer: PlusOffer | null;
  earlyBird: PlusEarlyBird | null;
  offsetMs: number;
  onExpire?: () => void;
  href?: string;
}> = ({ offer, earlyBird, offsetMs, onExpire, href = '/plus' }) => {
  const t = useT();
  const f = useWalletFormat(offer?.currency);
  const { live, text } = useCountdown(earlyBird?.expiresAt, offsetMs, onExpire);
  if (!offer || !earlyBird || !live) {
    return null;
  }
  return (
    <div className={clsx(CARD, 'flex flex-col gap-[12px] px-[16px] py-[14px] bg-newBgColorInner')}>
      <div
        className={clsx(
          'flex items-center gap-[6px] text-[14px] font-[700]',
          EARLY_BIRD_TEXT
        )}
      >
        <PlusBadgeIcon size={16} />
        {t(
          'plus_code_line_plus',
          '{{percent}}% off your first Plus payment with this code',
          { percent: earlyBird.percent }
        )}
      </div>
      <EarlyBirdStrip earlyBird={earlyBird} timer={text} />
      <div className="flex items-center flex-wrap gap-x-[16px] gap-y-[10px]">
        <span className="flex flex-col gap-[4px] min-w-0">
          {offer.intervals.map((i) => (
            <PlusPriceVsTopUps key={i.interval} offer={offer} interval={i} />
          ))}
        </span>
        <Link
          href={href}
          target="_blank"
          className={clsx(BTN_PRIMARY, 'ms-auto h-[40px] text-[14px]')}
        >
          {t('plus_get', 'Get Plus')}
        </Link>
      </div>
      <div className="text-[12px] text-textItemBlur tabular-nums">
        {t(
          'plus_early_bird_box_sub_rate',
          '{{credits}} credits every {{days}} days and every paid feature open.',
          { credits: f.number(offer.creditsPerPeriod), days: offer.periodDays }
        )}{' '}
        <TopUpRate offer={offer} />
      </div>
    </div>
  );
};
