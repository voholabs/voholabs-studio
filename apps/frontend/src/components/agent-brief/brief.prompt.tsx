'use client';

import { FC } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { TONE_TEXT } from '@gitroom/frontend/components/wallet-locks/wallet.access';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// What the user pastes into their agent to fill in the brief during
// onboarding. Plain words on purpose.
export const useBriefPrompt = () => {
  const t = useT();
  return t(
    'brief_prompt_first',
    "Learn my business through Voholabs Studio's brief interview, so every post you write sounds like us. Fill in what you can from our website and what you already know about the business, and only ask me to confirm what you can't find."
  );
};

// Brief page: opens the Upgrade brief flow, with its prompt for the user's
// own agent.
export const UpgradeBriefButton: FC = () => {
  const t = useT();
  return (
    <Link
      href="/flows/upgrade-brief"
      className={clsx(
        'inline-flex items-center gap-[6px] h-[32px] px-[12px] rounded-[8px] border border-warmRing text-[13px] font-[600] hover:bg-warmHover transition-colors',
        TONE_TEXT.warm
      )}
    >
      {t('brief_improve_button', 'Improve brief')}
    </Link>
  );
};
