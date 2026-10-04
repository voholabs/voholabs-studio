'use client';

import { useTrackView } from '@gitroom/helpers/utils/use.fire.events';
import { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { AgentBrief } from '@gitroom/frontend/components/agent-brief/agent.brief';
import {
  BRIEF_DOCUMENTS_KEY,
  useBriefDocuments,
} from '@gitroom/frontend/components/agent-brief/use.brief.documents';
import {
  BRIEF_ONBOARDING_KEY,
  useBriefOnboarding,
  useStartBriefOnboarding,
} from '@gitroom/frontend/components/agent-brief/use.brief.onboarding';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  TONE_TEXT,
  useActionTone,
  useFeatureTone,
  useWalletAccess,
} from '@gitroom/frontend/components/wallet-locks/wallet.access';
import {
  findAction,
  useWalletFormat,
  useWalletPrices,
} from '@gitroom/frontend/components/wallet/wallet.hooks';
import {
  tFreeUse,
  tTopUpGift,
} from '@gitroom/frontend/components/wallet/wallet.text';
import { LockedFeature } from '@gitroom/frontend/components/wallet-locks/locked.feature';
import {
  BriefMenuIcon,
  CoinsIcon,
} from '@gitroom/frontend/components/wallet-locks/wallet.icons';

type T = ReturnType<typeof useT>;

// The page a free workspace sees locked, and a pay-as-you-go workspace with
// no brief yet sees open.
const briefCopy = (t: T) => ({
  eyebrow: t('brief', 'Brief'),
  title: t(
    'brief_locked_title',
    'One living document that makes every post sound like you'
  ),
  body: t(
    'brief_locked_body',
    'The agent brief holds who you are, your audience, your voice, your offers and what has worked. Your agent reads it before it writes anything.'
  ),
  bullets: [
    t('brief_locked_bullet_1', 'Every post sounds like you, on every channel.'),
    t(
      'brief_locked_bullet_2',
      'Your agent learns from results and keeps the brief up to date.'
    ),
    t('brief_locked_bullet_3', 'A guided onboarding sets it up in one sitting.'),
  ],
});

// Free plan, nothing topped up: the brief is shown, not opened. What the
// top-up gives for free comes from the brief.onboarding price row.
const LockedBrief: FC = () => {
  const t = useT();
  const tone = useFeatureTone('brief');
  const { data: prices } = useWalletPrices();
  const onboarding = findAction(prices, 'brief.onboarding');
  return (
    <LockedFeature
      icon={<BriefMenuIcon size={28} />}
      tone={tone}
      {...briefCopy(t)}
      gift={prices ? tTopUpGift(t, onboarding) : undefined}
      cta={t('brief_locked_cta', 'Top up to start the brief onboarding')}
    />
  );
};

// Nothing written yet: the same page, open, with one way in (the guided
// onboarding) and a quieter one (write it by hand). What is free comes from
// the brief.onboarding price row, as on the locked page; paid plans are never
// charged, so they see no price.
const BriefEmptyState: FC<{
  onCreate: () => void;
  onWrite?: () => void;
  busy: boolean;
  showFree: boolean;
}> = ({ onCreate, onWrite, busy, showFree }) => {
  const t = useT();
  const tone = useFeatureTone('brief');
  const { data: prices } = useWalletPrices(showFree);
  const onboarding = findAction(prices, 'brief.onboarding');
  const free = showFree && onboarding ? tFreeUse(t, onboarding) : '';
  return (
    <LockedFeature
      icon={<BriefMenuIcon size={28} />}
      tone={tone}
      {...briefCopy(t)}
      action={{
        label: busy
          ? t('brief_onboarding_opening', 'Opening...')
          : t('brief_create', 'Create your brief'),
        onClick: onCreate,
        disabled: busy,
      }}
      secondary={
        onWrite
          ? {
              label: t('brief_write_myself', 'Write it myself instead'),
              onClick: onWrite,
            }
          : undefined
      }
      gift={free || undefined}
      note={t('brief_create_note', 'Starts a short guided onboarding.')}
    />
  );
};

// An onboarding was opened and has not reported back yet.
const BriefOnboardingRunning: FC<{
  onContinue: () => void;
  onWrite: () => void;
  busy: boolean;
}> = ({ onContinue, onWrite, busy }) => {
  const t = useT();
  const tone = useFeatureTone('brief');
  return (
    <LockedFeature
      icon={<BriefMenuIcon size={28} />}
      tone={tone}
      eyebrow={t('brief', 'Brief')}
      title={t(
        'brief_onboarding_running_title',
        'Your onboarding is in progress'
      )}
      body={t(
        'brief_onboarding_running_body',
        'Finish the guided onboarding and your brief appears here. If you closed it, pick up where you left off.'
      )}
      action={{
        label: busy
          ? t('brief_onboarding_opening', 'Opening...')
          : t('brief_onboarding_continue', 'Continue onboarding'),
        onClick: onContinue,
        disabled: busy,
      }}
      secondary={{
        label: t('brief_write_myself', 'Write it myself instead'),
        onClick: onWrite,
      }}
    />
  );
};

// Redoing the onboarding is a paid action for wallet workspaces (the first
// run is free, later ones cost the brief.onboarding price, charged when the
// user confirms), so it carries the warm accent and asks first. The price comes from the price row; paid plans
// are never charged and only see that it starts over.
const RedoOnboardingButton: FC<{
  onConfirm: () => void;
  busy: boolean;
  wallet: boolean;
  charged: boolean;
  // A run is already open: confirming reopens it, nothing is charged.
  reopens: boolean;
}> = ({ onConfirm, busy, wallet, charged, reopens }) => {
  const t = useT();
  const tone = useActionTone('brief.onboarding');
  const format = useWalletFormat();
  const { data: prices } = useWalletPrices(wallet);
  const onboarding = findAction(prices, 'brief.onboarding');

  const ask = useCallback(async () => {
    const startsOver = t(
      'brief_onboarding_redo_body',
      'This starts the guided onboarding over, and your brief is written again from your new answers.'
    );
    let cost = '';
    if (wallet && onboarding && !reopens) {
      cost =
        charged && onboarding.price > 0
          ? t(
              'brief_onboarding_redo_cost',
              'Starting over costs {{credits}} credits, taken from your wallet now. If the onboarding fails or is not finished, they are refunded.',
              {
                credits: format.credits(onboarding.price),
                interpolation: { escapeValue: false },
              }
            )
          : t(
              'brief_onboarding_redo_free',
              'This run is free. Later runs cost {{credits}} credits each.',
              {
                credits: format.credits(onboarding.price),
                interpolation: { escapeValue: false },
              }
            );
    }
    // An onboarding already open is continued, not restarted: say so, and
    // what a new one costs, so the dialog never reads as a free redo.
    const ok = reopens
      ? await deleteDialog(
          wallet && onboarding && onboarding.price > 0
            ? t(
                'brief_onboarding_continue_body_cost',
                'You have an onboarding in progress. Continuing it costs nothing extra. Starting a new one after it costs {{credits}} credits.',
                {
                  credits: format.credits(onboarding.price),
                  interpolation: { escapeValue: false },
                }
              )
            : t(
                'brief_onboarding_continue_body',
                'You have an onboarding in progress. Continue where you left off.'
              ),
          t('brief_onboarding_continue_confirm', 'Continue'),
          t('brief_onboarding_continue_title', 'Continue your onboarding?'),
          t('cancel', 'Cancel')
        )
      : await deleteDialog(
          cost ? `${startsOver} ${cost}` : startsOver,
          t('brief_onboarding_redo_confirm', 'Start over'),
          t('brief_onboarding_redo_title', 'Redo the onboarding?'),
          t('cancel', 'Cancel')
        );
    if (ok) {
      onConfirm();
    }
  }, [t, wallet, onboarding, charged, reopens, format, onConfirm]);

  return (
    <button
      type="button"
      onClick={ask}
      disabled={busy}
      className={clsx(
        'inline-flex items-center gap-[6px] h-[32px] px-[12px] rounded-[8px] border border-warmRing text-[13px] font-[600] hover:bg-warmHover transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        TONE_TEXT[tone]
      )}
    >
      {wallet && <CoinsIcon size={13} />}
      {busy
        ? t('brief_onboarding_opening', 'Opening...')
        : t('brief_onboarding_redo', 'Redo onboarding')}
    </button>
  );
};

// Back from the onboarding (?onboarding=done): read the brief again once and
// tidy the address bar.
const useOnboardingReturn = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('onboarding')) {
      return;
    }
    url.searchParams.delete('onboarding');
    window.history.replaceState(null, '', url.pathname + url.search);
    mutate(BRIEF_DOCUMENTS_KEY);
    mutate(BRIEF_ONBOARDING_KEY);
  }, [mutate]);
};

// Pay-as-you-go and paid plans: the guided onboarding when the brief is
// empty, the brief (with a way to redo the onboarding) once it is written.
const OpenBrief: FC<{ showFree: boolean }> = ({ showFree }) => {
  useOnboardingReturn();
  const { data, isLoading } = useBriefDocuments();
  const { data: onboarding, isLoading: onboardingLoading } =
    useBriefOnboarding();
  const { start, busy } = useStartBriefOnboarding();
  const [creating, setCreating] = useState(false);

  if ((isLoading && !data) || (onboardingLoading && !onboarding)) {
    return <LoadingComponent />;
  }

  // Without an onboarding site the page stays as it was: pay-as-you-go
  // gets the editor behind the same button, paid plans the editor.
  if (!onboarding?.available) {
    if (!showFree || data?.documents?.length || creating) {
      return <AgentBrief />;
    }
    return (
      <BriefEmptyState
        onCreate={() => setCreating(true)}
        busy={false}
        showFree={showFree}
      />
    );
  }

  if (!data?.documents?.length && !creating) {
    if (onboarding.running) {
      return (
        <BriefOnboardingRunning
          onContinue={start}
          onWrite={() => setCreating(true)}
          busy={busy}
        />
      );
    }
    return (
      <BriefEmptyState
        onCreate={start}
        onWrite={() => setCreating(true)}
        busy={busy}
        showFree={showFree}
      />
    );
  }

  return (
    <AgentBrief
      headerAction={
        <RedoOnboardingButton
          onConfirm={start}
          busy={busy}
          wallet={showFree}
          charged={!!onboarding.nextRunCharged}
          reopens={!!onboarding.running}
        />
      }
    />
  );
};

export const BriefPage: FC = () => {
  const access = useWalletAccess();
  useTrackView('brief_viewed');

  if (!access) {
    return <LoadingComponent />;
  }
  // Locked before the brief API is called: it answers 402 for this workspace,
  // which would open the top-up on its own.
  if (access === 'free') {
    return <LockedBrief />;
  }
  return <OpenBrief showFree={access === 'payg'} />;
};
