'use client';

import { FC, useCallback, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { AgentBrief } from '@gitroom/frontend/components/agent-brief/agent.brief';
import { useBriefDocuments } from '@gitroom/frontend/components/agent-brief/use.brief.documents';
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
import {
  BTN_PRIMARY,
  BTN_SIMPLE,
  LockedFeature,
} from '@gitroom/frontend/components/wallet-locks/locked.feature';
import {
  BriefMenuIcon,
  CoinsIcon,
} from '@gitroom/frontend/components/wallet-locks/wallet.icons';

// Free plan, nothing topped up: the brief is shown, not opened.
const LockedBrief: FC = () => {
  const t = useT();
  return (
    <LockedFeature
      icon={<BriefMenuIcon size={28} />}
      eyebrow={t('brief', 'Brief')}
      title={t(
        'brief_locked_title',
        'One living document that makes every post sound like you'
      )}
      body={t(
        'brief_locked_body',
        'The agent brief holds who you are, your audience, your voice, your offers and what has worked. Your agent reads it before it writes anything.'
      )}
      bullets={[
        t('brief_locked_bullet_1', 'Every post sounds like you, on every channel.'),
        t(
          'brief_locked_bullet_2',
          'Your agent learns from results and keeps the brief up to date.'
        ),
        t(
          'brief_locked_bullet_3',
          'A guided onboarding sets it up in one sitting.'
        ),
      ]}
      cta={t('brief_locked_cta', 'Top up to start the brief onboarding')}
    />
  );
};

// Pay-as-you-go with nothing written yet: one way in, the guided onboarding.
const BriefEmptyState: FC<{ onWriteMyself: () => void }> = ({
  onWriteMyself,
}) => {
  const t = useT();
  const { data: prices } = useWalletPrices('brief');
  const onboarding = findPrice(prices, 'brief.onboarding');
  const firstFree =
    onboarding?.freePeriod === 'ONCE' && (onboarding?.freeUnits || 0) >= 1;

  return (
    <div className="flex-1 bg-newBgColorInner flex items-center justify-center p-[24px] overflow-auto">
      <div className="flex flex-col items-center text-center gap-[14px] max-w-[440px]">
        <div className="w-[64px] h-[64px] rounded-full bg-tealSoft text-tealText flex items-center justify-center">
          <BriefMenuIcon size={28} />
        </div>
        <h2 className="text-[22px] font-[600]">
          {t('brief_setup_title', 'Set up your brief')}
        </h2>
        <div className="text-[14px] text-textItemBlur leading-[1.5]">
          {t(
            'brief_setup_body',
            'A guided onboarding builds your brief in one sitting: your business, your audience, your voice and your offers. Your agent reads it before it writes anything.'
          )}
        </div>
        {/* TODO(wallet): run the guided brief onboarding here. The existing
            onboarding (Agent37) also creates an agent, which wallet
            workspaces must not get, so the button stays off until an
            onboarding that only fills the brief exists. */}
        <button
          type="button"
          disabled={true}
          className={`${BTN_PRIMARY} mt-[6px]`}
        >
          {t('brief_start_onboarding', 'Start onboarding')}
        </button>
        <div className="text-[12px] text-textItemBlur leading-[1.5]">
          {t(
            'brief_onboarding_soon',
            'The guided onboarding is almost ready. Until then, write the brief yourself or let your agent fill it in through MCP.'
          )}
          {firstFree &&
            ' ' +
              t('brief_onboarding_first_free', 'Your first onboarding is free.')}
        </div>
        <button
          type="button"
          onClick={onWriteMyself}
          className="text-[14px] font-[600] text-tealText hover:underline underline-offset-2"
        >
          {t('brief_write_myself', 'Write it myself')}
        </button>
      </div>
    </div>
  );
};

const BriefRedoModal: FC<{ close: () => void }> = ({ close }) => {
  const t = useT();
  const toaster = useToaster();
  const { data: prices } = useWalletPrices('brief');
  const { data: wallet } = useWalletSummary();
  const price = findPrice(prices, 'brief.onboarding')?.price ?? 0;
  const balance = wallet?.balance ?? 0;
  const after = balance - price;
  const short = after < 0;
  const autoCovers = short && !!wallet?.autoTopUp?.enabled;
  const needTopUp = short && !autoCovers;

  const confirm = useCallback(() => {
    if (needTopUp) {
      close();
      openTopUp();
      return;
    }
    // TODO(wallet): charge brief.onboarding and start the onboarding again
    // once the redo endpoint exists.
    toaster.show(
      t('brief_redo_not_ready', 'Redoing the onboarding is not available yet.'),
      'warning'
    );
    close();
  }, [needTopUp, close, toaster, t]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="text-[14px] text-textItemBlur leading-[1.55]">
        {t(
          'brief_redo_body',
          'This starts the guided onboarding again and rebuilds your brief. It costs {{credits}} credits.',
          { credits: formatCredits(price) }
        )}
      </div>
      <div className="flex flex-col gap-[6px] p-[14px] rounded-[8px] bg-newTableHeader text-[14px]">
        <div className="flex justify-between gap-[12px]">
          <span className="text-textItemBlur">
            {t('wallet_balance', 'Balance')}
          </span>
          <span className="tabular-nums" dir="ltr">
            {formatCredits(balance)}
          </span>
        </div>
        <div className="flex justify-between gap-[12px]">
          <span className="text-textItemBlur">
            {t('wallet_balance_after', 'Balance after')}
          </span>
          <span
            className={`tabular-nums font-[600] ${short ? 'text-warm' : ''}`}
            dir="ltr"
          >
            {after < 0 ? '−' : ''}
            {formatCredits(Math.abs(after))}
          </span>
        </div>
      </div>
      {needTopUp && (
        <div className="text-[13px] text-warm">
          {t('brief_redo_short', 'Not enough credits. Top up to continue.')}
        </div>
      )}
      {autoCovers && (
        <div className="text-[13px] text-textItemBlur">
          {t('brief_redo_auto', 'Auto top-up runs first.')}
        </div>
      )}
      <div className="flex gap-[8px] justify-end flex-wrap">
        <button type="button" onClick={close} className={BTN_SIMPLE}>
          {t('cancel', 'Cancel')}
        </button>
        <button type="button" onClick={confirm} className={BTN_PRIMARY}>
          {needTopUp
            ? t('wallet_top_up', 'Top up')
            : t('brief_redo_confirm', 'Redo for {{credits}} credits', {
                credits: formatCredits(price),
              })}
        </button>
      </div>
    </div>
  );
};

// Same shape as the header's outline buttons. Gold with coins: a redo costs
// credits.
const BriefRedoButton: FC = () => {
  const t = useT();
  const { openModal } = useModals();
  const open = useCallback(() => {
    openModal({
      title: t('brief_redo_title', 'Redo the brief onboarding?'),
      withCloseButton: true,
      closeOnClickOutside: true,
      closeOnEscape: true,
      maxSize: 500,
      children: (close) => <BriefRedoModal close={close} />,
    });
  }, [openModal, t]);
  return (
    <button
      type="button"
      onClick={open}
      className="flex items-center gap-[8px] h-[32px] px-[12px] rounded-[8px] border border-warm text-warm hover:bg-warmSoft text-[12px] font-[600] transition-colors select-none whitespace-nowrap"
    >
      <CoinsIcon size={14} />
      <span>{t('brief_redo_onboarding', 'Redo onboarding')}</span>
    </button>
  );
};

const PayAsYouGoBrief: FC = () => {
  const { data, isLoading } = useBriefDocuments();
  const [writeMyself, setWriteMyself] = useState(false);

  if (isLoading && !data) {
    return <LoadingComponent />;
  }

  const empty = !data?.documents?.length;
  if (empty && !writeMyself) {
    return <BriefEmptyState onWriteMyself={() => setWriteMyself(true)} />;
  }

  return <AgentBrief headerAction={empty ? undefined : <BriefRedoButton />} />;
};

export const BriefPage: FC = () => {
  const access = useWalletAccess();

  if (!access) {
    return <LoadingComponent />;
  }
  // Locked before the brief API is called: it answers 402 for this workspace,
  // which would open the top-up on its own.
  if (access === 'free') {
    return <LockedBrief />;
  }
  if (access === 'payg') {
    return <PayAsYouGoBrief />;
  }
  return <AgentBrief />;
};
