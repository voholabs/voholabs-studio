'use client';

import React, { FC, useCallback, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useWalletFormat } from '@gitroom/frontend/components/wallet/wallet.hooks';
import { useIsWalletAdmin } from '@gitroom/frontend/components/wallet/top.up.modal';
import {
  ArrowIcon,
  BTN_PRIMARY,
  BTN_SIMPLE,
  CARD,
  PILL_MUTED,
  Spinner,
} from '@gitroom/frontend/components/wallet/wallet.ui';
import {
  useApplyPlusPlan,
  usePlusActions,
  usePlusPlan,
} from '@gitroom/frontend/components/plus/plus.hooks';
import {
  PILL_PLUS,
  PlusBadgeIcon,
  PlusCredits,
  PlusOfferCard,
} from '@gitroom/frontend/components/plus/plus.offer';
import {
  PlusIntervalKey,
  PlusPlan,
} from '@gitroom/frontend/components/plus/plus.types';

// Starts Stripe Checkout for Plus and sends the browser there.
export const usePlusSubscribe = () => {
  const t = useT();
  const toaster = useToaster();
  const actions = usePlusActions();
  const fireEvents = useFireEvents();
  const [busy, setBusy] = useState(false);
  const subscribe = useCallback(
    async (interval: PlusIntervalKey) => {
      setBusy(true);
      fireEvents('plus_checkout_started', { interval });
      const { ok, status, body } = await actions.checkout(interval);
      if (ok && body?.url) {
        window.location.href = body.url;
        return;
      }
      setBusy(false);
      toaster.show(
        status === 403
          ? t(
              'plus_admin_only',
              'Only an admin of this workspace can subscribe to Plus.'
            )
          : body?.message ||
              t('plus_checkout_failed', 'Checkout could not start. Try again.'),
        'warning'
      );
    },
    [actions, toaster, t, fireEvents]
  );
  return { busy, subscribe };
};

// The Plus heading every Plus card starts with.
const PlusHeading: FC = () => {
  const t = useT();
  return (
    <div className="flex items-center gap-[8px] text-tealText text-[18px] font-[700]">
      <PlusBadgeIcon size={18} />
      {t('plus_name', 'Plus')}
    </div>
  );
};

const NotAvailable: FC = () => {
  const t = useT();
  return (
    <div className={clsx(CARD, 'p-[24px] flex flex-col gap-[8px]')}>
      <PlusHeading />
      <div className="text-[14px] text-textItemBlur leading-[1.55]">
        {t(
          'plus_not_available',
          'Plus is not available yet. Everything free stays free in the meantime.'
        )}
      </div>
    </div>
  );
};

// The wallet is on hold after a refund or dispute: no Plus can be bought
// until support lifts it.
const PlusOnHold: FC = () => {
  const t = useT();
  return (
    <div className={clsx(CARD, 'p-[24px] mobile:p-[16px] flex flex-col gap-[8px]')}>
      <PlusHeading />
      <div className="text-[14px] text-textItemBlur leading-[1.55]" role="status">
        {t(
          'plus_on_hold',
          'Your wallet is on hold after a refund or dispute of a payment, so Plus cannot be bought. Contact support to sort it out.'
        )}
      </div>
    </div>
  );
};

// After a failed Plus payment that Stripe is still collecting: Plus is off
// until it is paid, and the card is updated in Stripe's billing portal (not
// with a second subscription). On the Plus page and the wallet.
export const PlusPaymentFailedNotice: FC = () => {
  const t = useT();
  const toaster = useToaster();
  const actions = usePlusActions();
  const isAdmin = useIsWalletAdmin();
  const [busy, setBusy] = useState(false);
  const updateCard = useCallback(async () => {
    setBusy(true);
    const { ok, body } = await actions.billing();
    if (ok && body?.url) {
      window.location.href = body.url;
      return;
    }
    setBusy(false);
    toaster.show(
      body?.message ||
        t('plus_update_card_failed', 'The card page could not open. Try again.'),
      'warning'
    );
  }, [actions, toaster, t]);
  return (
    <div
      role="alert"
      className="flex flex-col gap-[10px] rounded-[12px] border border-warmRing bg-warmSoft px-[16px] py-[14px]"
    >
      <div className="text-[14px] font-[700] text-warm">
        {t('plus_payment_failed_title', 'Payment failed, update your card')}
      </div>
      <div className="text-[14px] leading-[1.55] text-newTextColor/80">
        {isAdmin
          ? t(
              'plus_payment_failed_body',
              'Your last Plus payment did not go through, so Plus is paused. Update your card and it is charged again; there is no need to subscribe again.'
            )
          : t(
              'plus_payment_failed_body_member',
              'Your last Plus payment did not go through, so Plus is paused. Ask an admin of this workspace to update the card.'
            )}
      </div>
      {isAdmin && (
        <button
          type="button"
          disabled={busy}
          onClick={updateCard}
          className={clsx(BTN_PRIMARY, 'self-start')}
        >
          {busy && <Spinner size={16} />}
          {t('plus_update_card', 'Update card')}
        </button>
      )}
    </div>
  );
};

const PlusPaymentFailed: FC = () => (
  <div className={clsx(CARD, 'p-[24px] mobile:p-[16px] flex flex-col gap-[16px]')}>
    <PlusHeading />
    <PlusPaymentFailedNotice />
  </div>
);

const PlusStatusCard: FC<{ plan: PlusPlan }> = ({ plan }) => {
  const t = useT();
  const toaster = useToaster();
  const actions = usePlusActions();
  const apply = useApplyPlusPlan();
  const isAdmin = useIsWalletAdmin();
  const f = useWalletFormat(plan.offer?.currency);
  const [busy, setBusy] = useState(false);
  const sub = plan.subscription!;
  const ending = !!sub.cancelAt;
  const date = sub.cancelAt || sub.periodEnd;

  const run = useCallback(
    async (kind: 'cancel' | 'resume') => {
      if (
        kind === 'cancel' &&
        !(await deleteDialog(
          t(
            'plus_cancel_message',
            'Plus stays on until the end of this period, then stops renewing. Plan credits end with it; top-up credits stay.'
          ),
          t('plus_cancel_confirm', 'Cancel Plus'),
          t('plus_cancel_title', 'Cancel Plus?'),
          t('plus_cancel_keep', 'Keep Plus')
        ))
      ) {
        return;
      }
      setBusy(true);
      const { ok, body } = await actions[kind]();
      setBusy(false);
      if (!ok) {
        toaster.show(
          body?.message ||
            t('plus_change_failed', 'That did not work. Try again.'),
          'warning'
        );
        return;
      }
      await apply(body);
      toaster.show(
        kind === 'cancel'
          ? t('plus_cancelled', 'Plus will end at the end of this period.')
          : t('plus_resumed', 'Plus will keep renewing.')
      );
    },
    [actions, apply, t, toaster]
  );

  return (
    <div className={clsx(CARD, 'p-[24px] mobile:p-[16px] flex flex-col gap-[16px]')}>
      <div className="flex items-center justify-between gap-[8px] flex-wrap">
        <PlusHeading />
        <span className={ending ? PILL_MUTED : PILL_PLUS}>
          {sub.interval === 'year'
            ? t('plus_annual', 'Annual')
            : t('plus_monthly', 'Monthly')}
        </span>
      </div>
      <div className="text-[14px] leading-[1.55]">
        {date
          ? ending
            ? t('plus_ends_on', 'Plus ends on {{date}}. It will not renew.', {
                date: f.dayMonthYear(new Date(date)),
              })
            : t('plus_renews_on', 'Renews on {{date}}.', {
                date: f.dayMonthYear(new Date(date)),
              })
          : null}{' '}
        {t('plus_credits_each', '{{credits}} plan credits every {{days}} days.', {
          credits: f.number(sub.creditsPerPeriod),
          days: plan.offer?.periodDays ?? 30,
        })}
      </div>
      <PlusCredits credits={plan.credits} currency={plan.offer?.currency} />
      <div className="flex flex-wrap gap-[8px]">
        <Link href="/wallet" className={BTN_SIMPLE}>
          {t('plus_open_wallet', 'Open wallet')} <ArrowIcon />
        </Link>
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(ending ? 'resume' : 'cancel')}
            className={BTN_SIMPLE}
          >
            {busy && <Spinner size={16} />}
            {ending
              ? t('plus_resume', 'Keep Plus')
              : t('plus_cancel', 'Cancel Plus')}
          </button>
        )}
      </div>
    </div>
  );
};

// Plus where the app needs it: the page, and the dialog a Plus lock opens.
// Subscribed, it shows the subscription; otherwise the offer.
// `page`: the /plus page, with the headline over the plans.
export const PlusPanel: FC<{ context?: string; page?: boolean }> = ({
  context,
  page,
}) => {
  const t = useT();
  const { data: plan, error, mutate } = usePlusPlan(true);
  const { busy, subscribe } = usePlusSubscribe();
  if (!plan) {
    return error ? (
      <div className="text-[14px] text-textItemBlur p-[12px]">
        {t('plus_unavailable', 'Plus could not be loaded right now.')}
      </div>
    ) : (
      <div className="flex justify-center py-[40px]">
        <Spinner />
      </div>
    );
  }
  if (plan.access.frozen) {
    return <PlusOnHold />;
  }
  if (plan.subscription?.paymentFailed) {
    return <PlusPaymentFailed />;
  }
  if (plan.subscription?.active) {
    return <PlusStatusCard plan={plan} />;
  }
  if (!plan.offer || !plan.paymentsEnabled) {
    return <NotAvailable />;
  }
  return (
    <PlusOfferCard
      offer={plan.offer}
      earlyBird={plan.earlyBird}
      offsetMs={plan.clockOffsetMs}
      onExpire={() => mutate()}
      onSubscribe={subscribe}
      busy={busy}
      hero={page}
      pricesHref="/wallet/prices"
      context={
        context ||
        (plan.access.legacy
          ? t(
              'plus_legacy_note',
              "You're on pay-as-you-go: top-ups, X and research data stay open as they are. Plus adds {{credits}} credits every month.",
              { credits: plan.offer.creditsPerPeriod }
            )
          : plan.access.grandfathered
          ? t(
              'plus_grandfathered_note',
              'Your credits keep working until they are used up. Top-ups need Plus.'
            )
          : undefined)
      }
    />
  );
};

