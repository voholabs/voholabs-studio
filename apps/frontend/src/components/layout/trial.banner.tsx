'use client';

import { FC } from 'react';
import dayjs from 'dayjs';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Days left in the free trial. Hidden for whitelisted organizations - they have
// no `trialEndsAt`, so there is nothing to count down.
export const TrialBanner: FC = () => {
  const user = useUser();
  const t = useT();

  if (!user?.trialEndsAt) {
    return null;
  }

  // Rounded up, so a fresh 7 day trial reads "7 days left" and not "6".
  const daysLeft = Math.max(
    0,
    Math.ceil(dayjs(user.trialEndsAt).diff(dayjs(), 'hour') / 24)
  );

  return (
    <div className="flex items-center text-[12px] font-[500] px-[10px] py-[4px] rounded-[6px] bg-amber-600/20 text-amber-500 whitespace-nowrap">
      {daysLeft === 0
        ? t('trial_last_day', 'Trial ends today')
        : `${daysLeft} ${
            daysLeft === 1
              ? t('trial_day_left', 'day left in trial')
              : t('trial_days_left', 'days left in trial')
          }`}
    </div>
  );
};
