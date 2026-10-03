'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useWalletAccess } from '@gitroom/frontend/components/wallet-locks/wallet.access';
import { LockedFeature } from '@gitroom/frontend/components/wallet-locks/locked.feature';
import {
  InfoIcon,
  SkillsIcon,
} from '@gitroom/frontend/components/wallet-locks/wallet.icons';

export const skillsLockedCopy = (t: ReturnType<typeof useT>) =>
  t(
    'skills_locked',
    'Ready-made skills for articles, image and video generation, writing, hooks, and tips and tricks. Skills are available to your agent through MCP.'
  );

// Skills are not in the database yet. When they are, this page lists them
// (tags as filter chips, a card per skill) from their API; until then it says
// they are coming.
const SkillsLibrary: FC = () => {
  const t = useT();
  const more = t(
    'skills_intro_more',
    'Your agent finds skills through MCP and picks the right one for each task. Every skill tells it which Studio tools to use.'
  );
  return (
    <div className="bg-newBgColorInner flex-1 relative min-w-0">
      <div className="absolute inset-0 overflow-y-auto p-[20px] flex flex-col gap-[16px]">
        <div className="inline-flex items-center gap-[6px] text-[14px] text-textItemBlur">
          <span>
            {t(
              'skills_intro',
              'Ready-made skills your agent can use. Using them is free.'
            )}
          </span>
          <span
            tabIndex={0}
            role="img"
            aria-label={more}
            data-tooltip-id="tooltip"
            data-tooltip-content={more}
            data-tooltip-class-name="!max-w-[280px] !whitespace-normal !leading-[1.5]"
            className="shrink-0 cursor-help text-textItemBlur hover:text-newTextColor"
          >
            <InfoIcon />
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center text-center gap-[14px] max-w-[440px] py-[40px]">
            <div className="w-[64px] h-[64px] rounded-full bg-tealSoft text-tealText flex items-center justify-center">
              <SkillsIcon size={28} />
            </div>
            <h2 className="text-[22px] font-[600]">
              {t('skills_coming_title', 'Skills are coming')}
            </h2>
            <div className="text-[14px] text-textItemBlur leading-[1.55]">
              {t(
                'skills_coming_body',
                'Ready-made skills for articles, image and video generation, writing, hooks, and tips and tricks will appear here. Your agent will find them through MCP.'
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SkillsPage: FC = () => {
  const t = useT();
  const access = useWalletAccess();

  if (!access) {
    return <LoadingComponent />;
  }
  if (access === 'free') {
    return (
      <LockedFeature
        icon={<SkillsIcon size={28} />}
        title={t('skills', 'Skills')}
        body={`${skillsLockedCopy(t)} ${t(
          'skills_locked_unlock',
          'A single top-up unlocks them.'
        )}`}
      />
    );
  }
  return <SkillsLibrary />;
};
