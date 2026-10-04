'use client';

import { useTrackView } from '@gitroom/helpers/utils/use.fire.events';
import { FC, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { AgentBrief } from '@gitroom/frontend/components/agent-brief/agent.brief';
import { useBriefDocuments } from '@gitroom/frontend/components/agent-brief/use.brief.documents';
import {
  useFeatureTone,
  useWalletAccess,
} from '@gitroom/frontend/components/wallet-locks/wallet.access';
import {
  findAction,
  useWalletPrices,
} from '@gitroom/frontend/components/wallet/wallet.hooks';
import {
  tFreeUse,
  tTopUpGift,
} from '@gitroom/frontend/components/wallet/wallet.text';
import { LockedFeature } from '@gitroom/frontend/components/wallet-locks/locked.feature';
import { BriefMenuIcon } from '@gitroom/frontend/components/wallet-locks/wallet.icons';

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

// Pay-as-you-go with nothing written yet: the same page, open, with one way
// in. What is free comes from the brief.onboarding price row, as on the
// locked page.
const BriefEmptyState: FC<{ onCreate: () => void }> = ({ onCreate }) => {
  const t = useT();
  const tone = useFeatureTone('brief');
  const { data: prices } = useWalletPrices();
  const onboarding = findAction(prices, 'brief.onboarding');
  const free = onboarding ? tFreeUse(t, onboarding) : '';
  return (
    <LockedFeature
      icon={<BriefMenuIcon size={28} />}
      tone={tone}
      {...briefCopy(t)}
      action={{
        label: t('brief_create', 'Create your brief'),
        onClick: onCreate,
      }}
      gift={free || undefined}
      note={t('brief_create_note', 'Starts a short guided onboarding.')}
    />
  );
};

// Until the guided onboarding exists, "Create your brief" opens the brief
// editor, and there is no "Redo onboarding".
const PayAsYouGoBrief: FC = () => {
  const { data, isLoading } = useBriefDocuments();
  const [creating, setCreating] = useState(false);

  if (isLoading && !data) {
    return <LoadingComponent />;
  }

  if (!data?.documents?.length && !creating) {
    return <BriefEmptyState onCreate={() => setCreating(true)} />;
  }

  return <AgentBrief />;
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
  if (access === 'payg') {
    return <PayAsYouGoBrief />;
  }
  return <AgentBrief />;
};
