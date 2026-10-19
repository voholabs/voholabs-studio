'use client';

import { useRefreshWallet } from '@gitroom/frontend/components/wallet/wallet.hooks';
import { usePlusPlan } from '@gitroom/frontend/components/plus/plus.hooks';
import { EarlyBirdOfferBox } from '@gitroom/frontend/components/plus/plus.offer';
import {
  useFireEvents,
  useTrackView,
} from '@gitroom/helpers/utils/use.fire.events';
import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR, { useSWRConfig } from 'swr';
import copy from 'copy-to-clipboard';
import { useSearchParams } from 'next/navigation';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { stripSensitiveParams } from '@gitroom/helpers/utils/utm.saver';
import { useAgentConnection } from '@gitroom/frontend/components/public-api/agent.connection.status';
import { orderBy } from 'lodash';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { AddProviderComponent } from '@gitroom/frontend/components/launches/add.provider.component';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { ConnectAgentPanel } from '@gitroom/frontend/components/public-api/public.component';
import clsx from 'clsx';
import { useWalletAccess } from '@gitroom/frontend/components/wallet-locks/wallet.access';
import { SUPPORT_URL } from '@gitroom/frontend/components/layout/top.menu';
import {
  OnboardingTeach,
  OnboardingTeachHeading,
  StepCheckIcon,
} from '@gitroom/frontend/components/onboarding/onboarding.teach';
import {
  OnboardingStatus,
  briefStarted,
  useOnboardingStatus,
} from '@gitroom/frontend/components/onboarding/use.onboarding.status';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  POS_SOFT,
  POS_TEXT,
  TEAL_SOFT,
  TEAL_TEXT,
} from '@gitroom/frontend/components/wallet/wallet.ui';

type OnboardingStepKey = 'channels' | 'agent' | 'brief' | 'start';

// What the browser saved on the first visit (see utm.saver). Storage can be
// blocked, and finishing matters more than where the visit came from.
const readAttribution = () => {
  try {
    return JSON.stringify({
      utm: JSON.parse(localStorage.getItem('utm') || '""') || '',
      landingUrl: stripSensitiveParams(
        localStorage.getItem('landingUrl') || ''
      ),
      referrer: stripSensitiveParams(localStorage.getItem('referrer') || ''),
    }).slice(0, 2000);
  } catch (err) {
    return '';
  }
};

interface OnboardingModalProps {
  onClose: () => void;
}

export const OnboardingModal: FC<OnboardingModalProps> = ({ onClose }) => {
  const modals = useModals();
  const t = useT();
  const user = useUser();
  // A paid plan keeps the onboarding it always had: channels only.
  const paidPlan = useWalletAccess() === 'plan';
  // A new workspace goes through the steps before it gets in. Each one can be
  // skipped; connecting its agent and having the agent fill at least one item
  // of the brief earn the welcome credits.
  const needsOnboarding = !!user?.needsOnboarding;
  // Onboarded before the welcome credits: shown again once, until they are
  // claimed or turned down.
  const mandatory = needsOnboarding || !!user?.welcomeCreditsPending;
  // Only an admin holds the API key an agent connects with, so an invited
  // member sees the channels step only; the agent and the brief are the
  // admin's (the server applies the same rule).
  const admin = !!user?.publicApi;
  const withBrief = mandatory && admin;
  // After the channels: connect an agent over MCP, then the prompts to start with.
  // The agent step needs the workspace's API key, so without one onboarding
  // ends after the channels as before.
  const hasAgentStep = !paidPlan && admin;
  const [step, setStep] = useState<OnboardingStepKey>('channels');
  // Also read when onboarding is opened again by hand, so the steps show
  // what was really done, never a guess.
  const { data: status, mutate: refreshStatus } = useOnboardingStatus(
    mandatory || hasAgentStep,
    step === 'brief' || step === 'start'
  );
  // The last step offers the welcome credits when there are any to claim.
  const withCredits =
    withBrief &&
    !!status &&
    (status.credits.available > 0 || status.credits.claimed);
  // Steps 2 and 3 say what earns the credits while they can be claimed.
  const creditsToClaim =
    withCredits && !!status && status.credits.available > 0;
  const backForCredits = useCallback(() => {
    setStep('agent');
  }, []);
  const query = useSearchParams();
  const { mutate } = useSWRConfig();
  const fetch = useFetch();
  const toaster = useToaster();
  const fireEvents = useFireEvents();

  // Leaving the last step (or the channels, for a member) ends onboarding,
  // with or without the steps before it done.
  const finish = useCallback(async () => {
    const res = !needsOnboarding
      ? undefined
      : await fetch('/user/onboarding', {
          method: 'POST',
          body: JSON.stringify({ attribution: readAttribution() }),
        }).catch(() => undefined);
    if (needsOnboarding && !res?.ok) {
      toaster.show(
        t('onboarding_finish_failed', 'Something went wrong. Try again.'),
        'warning'
      );
      return;
    }
    if (needsOnboarding) {
      fireEvents(
        'onboarding_step',
        { step: 'onboarding_done' },
        {
          send_instantly: true,
        }
      );
    }
    await mutate('/user/self');
    onClose();
  }, [needsOnboarding, fetch, toaster, t, fireEvents, mutate, onClose]);

  // Coming back to an unfinished onboarding opens it on the first open step.
  // Returning from connecting a channel stays on the channels.
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (!mandatory || resumed || !status) {
      return;
    }
    setResumed(true);
    if (query.get('added')) {
      return;
    }
    setStep(
      !status.channel || !admin
        ? 'channels'
        : !status.agent
        ? 'agent'
        : !briefStarted(status)
        ? 'brief'
        : 'start'
    );
  }, [mandatory, resumed, status, query, admin]);

  // Each step reads the status again, so a step just done (an agent that
  // connected, a channel added in another tab) is ticked, not shown skipped.
  useEffect(() => {
    refreshStatus();
  }, [step, refreshStatus]);

  // Every step opens at its top, not wherever the last one was scrolled to.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [step]);

  return (
    <div
      ref={top}
      className={clsx(
        'w-full min-h-full flex-1 flex relative',
        paidPlan ? 'p-[40px]' : 'p-[8px] sm:p-[40px]'
      )}
    >
      <style>{`#support-discord {display: none}`}</style>
      <div className="flex flex-1 min-w-0 bg-newBgColorInner rounded-[20px] flex-col relative">
        {/* The onboarding cannot be left, so help is always in reach. */}
        {mandatory && (
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute end-[16px] top-[16px] sm:end-[20px] sm:top-[20px] z-[2] flex items-center gap-[6px] h-[32px] px-[12px] rounded-[8px] border border-newBorder text-[13px] font-[600] text-textItemBlur hover:text-newTextColor transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            {t('onboarding_need_help', 'Need help?')}
          </a>
        )}
        {!mandatory && (
          <button
            className="outline-none absolute end-[20px] top-[20px] mantine-UnstyledButton-root mantine-ActionIcon-root hover:bg-tableBorder cursor-pointer mantine-Modal-close mantine-1dcetaa"
            type="button"
            onClick={modals.closeAll}
          >
            <svg
              viewBox="0 0 15 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
            >
              <path
                d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
              ></path>
            </svg>
          </button>
        )}
        <div
          className={clsx(
            'flex-1 flex min-w-0',
            paidPlan ? 'p-[40px]' : 'p-[16px] pt-[56px] sm:p-[40px]'
          )}
        >
          <div
            className={clsx(
              'flex flex-col gap-[24px] flex-1',
              !paidPlan && 'min-w-0'
            )}
          >
            {hasAgentStep && (
              <OnboardingStepper
                step={step}
                onGoTo={setStep}
                withBrief={withBrief}
                withCredits={withCredits}
                status={status}
              />
            )}
            {step === 'channels' ? (
              <OnboardingStep1
                onNext={
                  hasAgentStep
                    ? () => setStep('agent')
                    : mandatory
                    ? finish
                    : onClose
                }
                onSkip={onClose}
                hasNext={hasAgentStep}
                paidPlan={paidPlan}
                required={needsOnboarding}
              />
            ) : step === 'agent' ? (
              <OnboardingAgentStep
                onBack={() => setStep('channels')}
                onDone={() => setStep(withBrief ? 'brief' : 'start')}
                required={withBrief}
                creditsNote={creditsToClaim ? status?.credits : undefined}
              />
            ) : step === 'brief' ? (
              <OnboardingBriefStep
                onBack={() => setStep('agent')}
                onDone={() => setStep('start')}
                status={status}
                withCredits={withCredits}
                creditsNote={creditsToClaim}
              />
            ) : withBrief && !status ? null : withCredits && status ? (
              <OnboardingClaimStep
                status={status}
                onBack={() => setStep('brief')}
                onBackForCredits={backForCredits}
                onDone={finish}
              />
            ) : (
              <OnboardingGetStartedStep
                onBack={() => setStep(withBrief ? 'brief' : 'agent')}
                onDone={mandatory ? finish : onClose}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// "1 Connect channels", "2 Connect your agent", "3 Teach your agent", "4 Claim free credit" (or
// "Get started" when there are no credits to claim). Steps already passed
// stay clickable to go back: ticked when the server says they are done
// (a channel connected, the agent connected, one item of the brief filled), marked
// skipped when they are not.
export const OnboardingStepper: FC<{
  step: OnboardingStepKey;
  onGoTo: (step: OnboardingStepKey) => void;
  withBrief?: boolean;
  withCredits?: boolean;
  status?: OnboardingStatus;
}> = ({ step, onGoTo, withBrief, withCredits, status }) => {
  const t = useT();
  const steps: { key: OnboardingStepKey; label: string; done: boolean }[] = [
    {
      key: 'channels',
      label: t('onboarding_step_channels', 'Connect channels'),
      done: !!status?.channel,
    },
    {
      key: 'agent',
      label: t('onboarding_step_agent', 'Connect your agent'),
      done: !!status?.agent,
    },
    ...(withBrief
      ? [
          {
            key: 'brief' as const,
            label: t('onboarding_step_teach', 'Teach your agent'),
            done: briefStarted(status),
          },
        ]
      : []),
    {
      key: 'start',
      label: withCredits
        ? t('onboarding_step_claim_credit', 'Claim free credit')
        : t('onboarding_step_get_started', 'Get started'),
      done: false,
    },
  ];
  const current = steps.findIndex((s) => s.key === step);

  const circle = (
    state: 'done' | 'skipped' | 'current' | 'upcoming',
    index: number
  ) => (
    <span
      className={clsx(
        'shrink-0 w-[28px] h-[28px] rounded-full flex items-center justify-center text-[13px] font-[700] transition-colors',
        state === 'upcoming'
          ? 'border border-newBorder text-textItemBlur'
          : state === 'skipped'
          ? 'border border-dashed border-textItemBlur text-textItemBlur'
          : 'bg-btnPrimary text-white',
        state === 'current' && 'ring-4 ring-tealSoft'
      )}
    >
      {state === 'done' ? <StepCheckIcon /> : index}
    </span>
  );

  const label = (text: string, active: boolean) => (
    <span
      className={clsx(
        'text-[13px] sm:text-[14px] font-[600] whitespace-nowrap',
        active ? 'text-newTextColor' : 'text-textItemBlur hidden sm:inline'
      )}
    >
      {text}
    </span>
  );

  return (
    <nav
      aria-label={t('onboarding_steps', 'Onboarding steps')}
      className="flex items-center justify-center gap-[6px] sm:gap-[14px]"
    >
      {steps.map((item, index) => {
        const state =
          index < current
            ? item.done
              ? 'done'
              : 'skipped'
            : index === current
            ? 'current'
            : 'upcoming';
        const skipped = t('onboarding_step_skipped', 'Skipped');
        return (
          <React.Fragment key={item.key}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className={clsx(
                  'h-[2px] w-[12px] sm:w-[64px] rounded-full',
                  index <= current ? 'bg-btnPrimary' : 'bg-newBorder'
                )}
              />
            )}
            {state === 'done' || state === 'skipped' ? (
              <button
                type="button"
                onClick={() => onGoTo(item.key)}
                title={state === 'skipped' ? skipped : undefined}
                className="flex items-center gap-[8px] rounded-[8px] px-[4px] py-[2px] hover:opacity-80 transition-opacity"
              >
                {circle(state, index + 1)}
                {label(item.label, false)}
                {state === 'skipped' && (
                  <span className="sr-only">{skipped}</span>
                )}
              </button>
            ) : (
              <div
                aria-current={state === 'current' ? 'step' : undefined}
                className="flex items-center gap-[8px] px-[4px] py-[2px]"
              >
                {circle(state, index + 1)}
                {label(item.label, state === 'current')}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export const OnboardingStep1: FC<{
  onNext: () => void;
  onSkip: () => void;
  hasNext?: boolean;
  // The look a paid plan always had.
  paidPlan?: boolean;
  // A new workspace's onboarding, which cannot be closed: the channels can
  // be skipped like the steps after them.
  required?: boolean;
}> = ({ onNext, onSkip, hasNext, paidPlan, required }) => {
  const fetch = useFetch();
  const t = useT();
  const { mutate } = useSWRConfig();
  // Coming back from another tab (a channel's sign-in, or the Plus page)
  // re-reads the user, so what changed there shows here straight away.
  useEffect(() => {
    if (!required) {
      return;
    }
    const refresh = () => mutate('/user/self');
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [required, mutate]);
  useTrackView('onboarding_step', { step: 'connect_channel' });

  const getIntegrations = useCallback(async () => {
    return (await fetch('/integrations')).json();
  }, []);

  const load = useCallback(async (path: string) => {
    const list = (await (await fetch(path)).json()).integrations;
    return list;
  }, []);

  const { data: integrations } = useSWR('/integrations/list', load, {
    // Required: the list follows a channel connected in another tab.
    refreshInterval: required ? 4000 : 0,
    revalidateOnFocus: !!required,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });

  const sortedIntegrations = useMemo(() => {
    return orderBy(
      integrations,
      ['type', 'disabled', 'identifier'],
      ['desc', 'asc', 'asc']
    );
  }, [integrations]);

  const { data } = useSWR('get-all-integrations-onboarding', getIntegrations);
  const ready = sortedIntegrations.length > 0;

  return (
    <div className="flex flex-col gap-[24px]">
      <div className="flex gap-[4px] flex-col text-center">
        <div className="text-[24px] font-semibold">
          {t('connect_your_channels', 'Connect Your Channels')}
        </div>
        <div className="text-[14px] text-customColor18">
          {t(
            'connect_social_media_to_start',
            'Connect your social media accounts to start scheduling posts'
          )}
        </div>
      </div>

      {/* Connected channels */}
      {sortedIntegrations.length > 0 && (
        <div className="bg-newTableHeader rounded-[8px] p-[16px]">
          <div className="text-[14px] font-medium mb-[12px]">
            {t('connected_channels', 'Connected Channels')} (
            {sortedIntegrations.length})
          </div>
          <div className="flex flex-wrap gap-[12px]">
            {sortedIntegrations.map((integration: any) => (
              <div
                key={integration.id}
                className="flex items-center gap-[8px] bg-customColor47/30 rounded-[8px] px-[12px] py-[8px]"
              >
                <div className="relative w-[28px] h-[28px]">
                  <SafeImage
                    src={integration.picture}
                    className="rounded-full"
                    alt={integration.identifier}
                    width={28}
                    height={28}
                  />
                  <SafeImage
                    src={`/icons/platforms/${integration.identifier}.png`}
                    className="rounded-full absolute -bottom-[3px] -end-[3px] border border-fifth"
                    alt={integration.identifier}
                    width={14}
                    height={14}
                  />
                </div>
                <span className="text-[13px]">{integration.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available platforms - using AddProviderComponent */}
      <div className="flex flex-col gap-[12px]">
        <div className="text-[14px] font-medium">
          {t('click_channel_to_add', 'Click a channel to add it')}
        </div>
        {data && (
          <AddProviderComponent
            invite={false}
            social={data.social || []}
            article={data.article || []}
            onboarding={true}
          />
        )}
      </div>

      {/* Action buttons, kept in view while the channel list scrolls */}
      <div
        className={clsx(
          'flex pt-[24px] mt-[8px]',
          required
            ? 'sticky bottom-0 z-[1] -mx-[16px] sm:-mx-[40px] -mb-[16px] sm:-mb-[40px] px-[16px] sm:px-[40px] pb-[16px] sm:pb-[24px] [@media(max-height:500px)]:py-[10px] bg-newBgColorInner border-t border-newBorder flex-col sm:flex-row items-stretch sm:items-center justify-between gap-[12px] rounded-b-[20px]'
            : 'justify-end'
        )}
      >
        {required && (
          <div
            className={clsx(
              'text-[14px] flex items-center gap-[8px]',
              ready ? 'text-newTextColor' : 'text-textItemBlur'
            )}
          >
            {ready ? (
              <>
                <span className="w-[20px] h-[20px] rounded-full bg-btnPrimary text-white flex items-center justify-center">
                  <StepCheckIcon />
                </span>
                {t('onboarding_channel_ready', 'Channel connected')}
              </>
            ) : (
              t(
                'onboarding_channel_later',
                'No channel yet? You can add one later from the calendar.'
              )
            )}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-[8px] sm:gap-[12px]">
          {required && hasNext && !ready && (
            <button
              type="button"
              onClick={onNext}
              className="text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[12px] sm:px-[16px] h-[44px]"
            >
              {t('onboarding_skip_for_now', 'Skip for now')}
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={required && hasNext && !ready}
            className={
              required
                ? 'group flex items-center justify-center gap-[12px] w-full sm:w-auto bg-btnPrimary hover:brightness-110 text-white font-semibold px-[32px] py-[14px] [@media(max-height:500px)]:py-[10px] rounded-[12px] text-[16px] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100'
                : paidPlan
                ? 'group flex items-center gap-[12px] bg-gradient-to-r from-[#622aff] to-[#8b5cf6] hover:from-[#7c3aff] hover:to-[#9d6eff] text-white font-semibold px-[32px] py-[14px] rounded-[12px] text-[16px] transition-all shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40'
                : 'group flex items-center justify-center gap-[12px] w-full sm:w-auto bg-btnPrimary hover:brightness-110 text-white font-semibold px-[32px] py-[14px] rounded-[12px] text-[16px] transition-all'
            }
          >
            {hasNext
              ? t('onboarding_next_agent', 'Next: connect your agent')
              : sortedIntegrations.length > 0
              ? t('onboarding_start', 'Start')
              : t(
                  'onboarding_start_without_channels',
                  'Start without channels'
                )}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={
                paidPlan
                  ? 'group-hover:translate-x-1 transition-transform'
                  : 'group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:-scale-x-100 transition-transform'
              }
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

// What earns the welcome credits, shown on steps 2 and 3 while they can be
// claimed.
const CreditsNote: FC<{ available: number }> = ({ available }) => {
  const t = useT();
  return (
    <div
      className={clsx(
        'rounded-[12px] px-[16px] py-[12px] text-[14px] font-[500]',
        TEAL_SOFT,
        TEAL_TEXT
      )}
    >
      {t(
        'onboarding_credits_note',
        'To get your {{credits}} free credits, connect your agent and let it fill in at least one item under What your agent knows.',
        { credits: available / 100 }
      )}
    </div>
  );
};

// Second step: connect the agent. The panel asks which agent first, then shows
// that agent's steps only. During a new workspace's onboarding the person says
// when they have done them. It can be skipped; only the welcome credits wait
// on it.
const OnboardingAgentStep: FC<{
  onBack: () => void;
  onDone: () => void;
  required?: boolean;
  creditsNote?: OnboardingStatus['credits'];
}> = ({ onBack, onDone, required, creditsNote }) => {
  const t = useT();
  useTrackView('onboarding_step', { step: 'connect_agent' });
  return (
    <div className="flex flex-col gap-[24px] w-full max-w-[760px] mx-auto">
      {!!creditsNote && <CreditsNote available={creditsNote.available} />}
      <div className="flex gap-[4px] flex-col text-center">
        <div className="text-[24px] font-semibold">
          {t('onboarding_connect_agent', 'Connect your agent')}
        </div>
        <div className="text-[14px] text-textItemBlur">
          {required
            ? t(
                'onboarding_connect_agent_sub_pick',
                'Your agent writes and schedules your posts. Pick the one you use.'
              )
            : t(
                'onboarding_connect_agent_sub_short',
                'Let Claude, ChatGPT or your coding agent write and schedule posts for you. You can also do this later in Settings.'
              )}
        </div>
      </div>
      <ConnectAgentPanel bare={true} mcpOnly={required} pickFirst={true} />
      {/* Required: kept in view below the long panel. */}
      <div
        className={clsx(
          'flex flex-wrap items-center justify-between gap-[12px] pt-[16px] border-t border-newBorder',
          required &&
            'sticky bottom-0 z-[1] bg-newBgColorInner pb-[16px] sm:pb-[24px]'
        )}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-[6px] text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[8px] h-[44px]"
        >
          <BackArrowIcon />
          {t('onboarding_back', 'Back')}
        </button>
        <div className="flex items-center gap-[8px] sm:gap-[12px] ms-auto">
          <button
            type="button"
            onClick={onDone}
            className="text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[12px] sm:px-[16px] h-[44px]"
          >
            {t('onboarding_skip_for_now', 'Skip for now')}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="flex items-center bg-btnPrimary hover:brightness-110 text-white font-semibold px-[28px] sm:px-[32px] h-[48px] rounded-[12px] text-[16px] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
          >
            {required
              ? t('onboarding_did_those', 'I did those')
              : t('onboarding_next_get_started', 'Next: get started')}
          </button>
        </div>
      </div>
    </div>
  );
};

// Third step: the connected agent fills in the brief. The person pastes one
// prompt into it; every document is listed and ticks off as it is saved. Next
// waits until the agent has saved at least one, and Skip moves on without it
// (the welcome credits wait on it). Back returns to the connect steps.
const OnboardingBriefStep: FC<{
  onBack: () => void;
  onDone: () => void;
  status?: OnboardingStatus;
  withCredits?: boolean;
  creditsNote?: boolean;
}> = ({ onBack, onDone, status, withCredits, creditsNote }) => {
  const t = useT();
  useTrackView('onboarding_step', { step: 'brief' });
  const { data: connection } = useAgentConnection(true);
  const ready = !!status?.agent && briefStarted(status);
  return (
    <div className="flex flex-col gap-[24px] w-full max-w-[760px] mx-auto">
      {creditsNote && !!status && (
        <CreditsNote available={status.credits.available} />
      )}
      <OnboardingTeachHeading />
      <OnboardingTeach status={status} connection={connection} />
      {/* Kept in view, so the ticks and Next are seen as the agent works. */}
      <div className="flex flex-wrap items-center justify-between gap-[12px] pt-[16px] border-t border-newBorder sticky bottom-0 z-[1] bg-newBgColorInner pb-[16px] sm:pb-[24px]">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-[6px] text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[8px] h-[44px]"
        >
          <BackArrowIcon />
          {t('onboarding_back', 'Back')}
        </button>
        <div className="flex items-center gap-[8px] sm:gap-[12px] ms-auto">
          <span className="text-[14px] text-textItemBlur hidden sm:inline">
            {ready
              ? t('onboarding_teach_ready', 'Your agent knows your business')
              : t('onboarding_brief_waiting', 'Waiting for your agent...')}
          </span>
          {!ready && (
            <button
              type="button"
              onClick={onDone}
              className="text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[12px] sm:px-[16px] h-[44px]"
            >
              {t('onboarding_skip_for_now', 'Skip for now')}
            </button>
          )}
          <button
            type="button"
            onClick={onDone}
            disabled={!ready}
            className="flex items-center bg-btnPrimary hover:brightness-110 text-white font-semibold px-[28px] sm:px-[32px] h-[48px] rounded-[12px] text-[16px] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
          >
            {withCredits
              ? t('onboarding_next_claim_credit', 'Next: claim free credit')
              : t('onboarding_next_get_started', 'Next: get started')}
          </button>
        </div>
      </div>
    </div>
  );
};

const BackArrowIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="rtl:-scale-x-100"
    aria-hidden="true"
  >
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);

// Three prompts to start with, each one copied with a click and pasted into
// the agent the person just connected.
const StartPrompts: FC = () => {
  const t = useT();
  const [copied, setCopied] = useState<number | null>(null);
  const prompts = [
    t('onboarding_start_prompt_post', "Let's schedule my first post together."),
    t(
      'onboarding_start_prompt_flows',
      'What are flows? Show me what you can make for my business.'
    ),
    t(
      'onboarding_start_prompt_analytics',
      'How are my posts doing? Show me my analytics.'
    ),
  ];
  const copyPrompt = useCallback((index: number, prompt: string) => {
    copy(prompt);
    setCopied(index);
    setTimeout(() => setCopied(null), 2000);
  }, []);
  return (
    <div className="flex flex-col gap-[12px]">
      {prompts.map((prompt, index) => (
        <div
          key={index}
          className="flex flex-col sm:flex-row gap-[12px] sm:items-center bg-newBgColor border border-newBorder rounded-[12px] p-[14px]"
        >
          <div className="flex-1 text-[15px] select-all">{prompt}</div>
          <button
            type="button"
            onClick={() => copyPrompt(index, prompt)}
            className="shrink-0 h-[40px] px-[18px] rounded-[10px] bg-btnPrimary hover:brightness-110 text-white text-[14px] font-[600] transition-all"
          >
            {copied === index
              ? t('onboarding_brief_copied', 'Copied')
              : t('onboarding_brief_copy', 'Copy prompt')}
          </button>
        </div>
      ))}
    </div>
  );
};

// Last step: the three prompts to start with.
const OnboardingGetStartedStep: FC<{
  onBack?: () => void;
  onDone: () => void;
}> = ({ onBack, onDone }) => {
  const t = useT();
  useTrackView('onboarding_step', { step: 'get_started' });
  return (
    <div className="flex flex-col gap-[24px] w-full max-w-[760px] mx-auto">
      <div className="flex gap-[4px] flex-col text-center">
        <div className="text-[24px] font-semibold">
          {t('onboarding_get_started_title', 'Get started')}
        </div>
        <div className="text-[14px] text-textItemBlur">
          {t(
            'onboarding_get_started_sub',
            'Copy one of these and paste it into your agent.'
          )}
        </div>
      </div>
      <StartPrompts />
      <div className="flex flex-wrap items-center justify-between gap-[12px] pt-[16px] border-t border-newBorder">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-[6px] text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[8px] h-[44px]"
          >
            <BackArrowIcon />
            {t('onboarding_back', 'Back')}
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="ms-auto flex items-center bg-btnPrimary hover:brightness-110 text-white font-semibold px-[28px] sm:px-[32px] h-[48px] rounded-[12px] text-[16px] transition-all"
        >
          {t('onboarding_finish', 'Finish')}
        </button>
      </div>
    </div>
  );
};

// The early bird the claim (or a skip) started, with its live countdown.
const OnboardingEarlyBird: FC = () => {
  const { data: plan, mutate } = usePlusPlan(true);
  if (!plan || plan.access.plus || !plan.paymentsEnabled) {
    return null;
  }
  return (
    <EarlyBirdOfferBox
      offer={plan.offer}
      earlyBird={plan.earlyBird}
      offsetMs={plan.clockOffsetMs}
      onExpire={() => mutate()}
    />
  );
};

// Last step when there are welcome credits: the agent connected and at least
// one item of the brief filled earns them (the server checks again). Not there
// yet, it lists what is missing and leads back to step 2. Skipping asks
// first, since the credits are lost. Once claimed, the prompts to start with.
const OnboardingClaimStep: FC<{
  status: OnboardingStatus;
  onBack: () => void;
  onBackForCredits: () => void;
  onDone: () => void;
}> = ({ status, onBack, onBackForCredits, onDone }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { mutate } = useSWRConfig();
  const refreshWallet = useRefreshWallet();
  useTrackView('onboarding_step', { step: 'claim_credit' });
  const [claiming, setClaiming] = useState(false);
  const { available, claimed, eligible } = status.credits;
  const credits = available / 100;
  const missing = [
    ...(status.agent
      ? []
      : [t('onboarding_step_agent', 'Connect your agent')]),
    ...(briefStarted(status)
      ? []
      : [
          t(
            'onboarding_credits_one_item',
            'Let your agent fill in at least one item under What your agent knows'
          ),
        ]),
  ];

  const claim = useCallback(async () => {
    setClaiming(true);
    const res = await fetch('/user/onboarding/credits', {
      method: 'POST',
    }).catch(() => undefined);
    await mutate('/user/onboarding');
    setClaiming(false);
    if (!res?.ok) {
      toaster.show(
        t(
          'onboarding_credits_not_claimed',
          'The credits could not be added. Check that your agent has filled in at least one item, then try again.'
        ),
        'warning'
      );
      return;
    }
    // The wallet and Plus (claiming starts the early bird).
    refreshWallet();
  }, [fetch, mutate, refreshWallet, toaster, t]);

  const skip = useCallback(async () => {
    if (
      await deleteDialog(
        t(
          'onboarding_credits_skip_message',
          'To get them, connect your agent and let it fill in at least one item under What your agent knows. It takes a few minutes.'
        ),
        t('onboarding_credits_skip_confirm', 'Skip, no credits'),
        t('onboarding_credits_skip_title', "You'll miss {{credits}} free credits", {
          credits,
        }),
        t('onboarding_credits_want', 'I want the credits')
      )
    ) {
      // Turning them down is final, and recorded before onboarding ends.
      const res = await fetch('/user/onboarding/credits/skip', {
        method: 'POST',
      }).catch(() => undefined);
      if (!res?.ok) {
        toaster.show(
          t('onboarding_credits_skip_failed', 'Something went wrong. Try again.'),
          'warning'
        );
        return;
      }
      // Skipping starts the early bird too.
      refreshWallet();
      onDone();
      return;
    }
    onBackForCredits();
  }, [t, credits, fetch, toaster, refreshWallet, onDone, onBackForCredits]);

  if (claimed) {
    return (
      <div className="flex flex-col gap-[24px] w-full max-w-[760px] mx-auto">
        <div className="flex gap-[4px] flex-col text-center">
          <div className="text-[24px] font-semibold">
            {t('onboarding_credits_claimed_title', 'Your free credits are in')}
          </div>
          <div className="text-[14px] text-textItemBlur">
            {t(
              'onboarding_credits_claimed_sub',
              'They are in your wallet. Try your agent: copy one of these and paste it in.'
            )}
          </div>
        </div>
        <div
          className={clsx(
            'flex items-center gap-[10px] rounded-[12px] px-[16px] py-[12px] text-[14px] font-[600]',
            POS_SOFT,
            POS_TEXT
          )}
        >
          <StepCheckIcon />
          {t('onboarding_credits_added', 'Free credits added to your wallet')}
        </div>
        <OnboardingEarlyBird />
        <div className="text-[18px] font-semibold">
          {t('onboarding_get_started_title', 'Get started')}
        </div>
        <StartPrompts />
        <div className="flex flex-wrap items-center justify-end gap-[12px] pt-[16px] border-t border-newBorder">
          <button
            type="button"
            onClick={onDone}
            className="flex items-center bg-btnPrimary hover:brightness-110 text-white font-semibold px-[28px] sm:px-[32px] h-[48px] rounded-[12px] text-[16px] transition-all"
          >
            {t('onboarding_finish', 'Finish')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[24px] w-full max-w-[760px] mx-auto">
      <div className="flex gap-[4px] flex-col text-center">
        <div className="text-[24px] font-semibold">
          {t('onboarding_credits_title', 'Claim {{credits}} free credits', {
            credits,
          })}
        </div>
        <div className="text-[14px] text-textItemBlur">
          {eligible
            ? t(
                'onboarding_credits_ready',
                'Your agent knows your business. Claim your free credits and try it out.'
              )
            : t(
                'onboarding_credits_how',
                'To get them, connect your agent and let it fill in at least one item under What your agent knows.'
              )}
        </div>
      </div>
      {eligible ? (
        <button
          type="button"
          onClick={claim}
          disabled={claiming}
          className="self-center flex items-center bg-btnPrimary hover:brightness-110 text-white font-semibold px-[32px] h-[52px] rounded-[12px] text-[16px] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
        >
          {t('onboarding_credits_claim', 'Claim {{credits}} free credits', {
            credits,
          })}
        </button>
      ) : (
        <div className="flex flex-col gap-[10px]">
          <div className="text-[14px] font-[600]">
            {t('onboarding_credits_missing', 'Still to do')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[8px]">
            {missing.map((item) => (
              <div
                key={item}
                className="flex items-center gap-[10px] rounded-[10px] border border-newBorder px-[12px] py-[10px] text-[14px] text-textItemBlur"
              >
                <span className="shrink-0 w-[22px] h-[22px] rounded-full border border-newBorder" />
                {item}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onBackForCredits}
            className="self-center mt-[8px] flex items-center bg-btnPrimary hover:brightness-110 text-white font-semibold px-[32px] h-[48px] rounded-[12px] text-[16px] transition-all"
          >
            {t('onboarding_credits_complete', 'Complete the steps')}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-[12px] pt-[16px] border-t border-newBorder">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-[6px] text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[8px] h-[44px]"
        >
          <BackArrowIcon />
          {t('onboarding_back', 'Back')}
        </button>
        <button
          type="button"
          onClick={skip}
          className="ms-auto text-[15px] font-[600] text-textItemBlur hover:text-newTextColor px-[12px] sm:px-[16px] h-[44px]"
        >
          {t('onboarding_skip', 'Skip')}
        </button>
      </div>
    </div>
  );
};
