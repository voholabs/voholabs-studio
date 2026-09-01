'use client';

import { FC, ReactNode, useCallback } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface MediaMeterUsage {
  limit: number;
  used: number;
  reserved: number;
  available: number;
  percentUsed: number;
  resetAt: string | null;
}

type MediaMeterUsageResponse =
  | { state: 'not_configured' }
  | { state: 'unavailable' }
  | { state: 'ok'; usage: MediaMeterUsage };

const useMediaUsage = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<MediaMeterUsageResponse> => {
    return (await fetch('/media-meter/usage')).json();
  }, []);
  return useSWR('media-meter-usage', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

// Same card shell as the Connect Agent tab next door, so the two read as one
// area of settings.
const SectionCard: FC<{
  title: string;
  description: string;
  children: ReactNode;
}> = ({ title, description, children }) => (
  <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
    <div className="bg-newBgColorInner px-[20px] py-[14px] border-b border-newBorder">
      <div className="text-[15px] font-[600]">{title}</div>
      <div className="text-[13px] text-customColor18 mt-[2px]">
        {description}
      </div>
    </div>
    <div className="p-[20px] flex flex-col gap-[16px]">{children}</div>
  </div>
);

const formatCredits = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const LegendDot: FC<{ className: string; label: string }> = ({
  className,
  label,
}) => (
  <div className="flex items-center gap-[6px] text-[13px]">
    <div className={clsx('w-[10px] h-[10px] rounded-[3px]', className)} />
    {label}
  </div>
);

const UsageBar: FC<{ usage: MediaMeterUsage }> = ({ usage }) => {
  const t = useT();
  const { limit, used, reserved, available } = usage;

  const clampPercent = (value: number) =>
    limit > 0 ? Math.max(0, Math.min(100, (value / limit) * 100)) : 0;
  const usedPercent = clampPercent(used);
  // The reserved segment sits after the used one and never pushes past 100%.
  const reservedPercent = Math.min(clampPercent(reserved), 100 - usedPercent);

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="h-[14px] rounded-[7px] bg-newBgColorInner border border-newBorder overflow-hidden flex">
        {usedPercent > 0 && (
          <div
            className="bg-[#20808D] h-full"
            style={{ width: `${usedPercent}%` }}
          />
        )}
        {reservedPercent > 0 && (
          <div
            className="bg-[#20808D]/40 h-full"
            style={{ width: `${reservedPercent}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[6px]">
        <LegendDot
          className="bg-[#20808D]"
          label={`${t('media_usage_used', 'Used')}: ${formatCredits(
            used
          )} ${t('media_usage_credits', 'credits')}`}
        />
        <LegendDot
          className="bg-[#20808D]/40"
          label={`${t(
            'media_usage_reserved',
            'Reserved for running jobs'
          )}: ${formatCredits(reserved)} ${t(
            'media_usage_credits',
            'credits'
          )}`}
        />
      </div>
      <div className="text-[13px] text-customColor18">
        {formatCredits(available)}{' '}
        {t('media_usage_remaining_of', 'of')} {formatCredits(limit)}{' '}
        {t('media_usage_credits_remaining', 'credits remaining')}
      </div>
    </div>
  );
};

export const UsageComponent: FC = () => {
  const t = useT();
  const { data } = useMediaUsage();

  if (!data) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <SectionCard
        title={t('media_usage_title', 'AI media editing')}
        description={t(
          'media_usage_description',
          'Credit used by AI image and video editing in this workspace.'
        )}
      >
        {data.state === 'not_configured' && (
          <div className="text-[13px] text-customColor18">
            {t(
              'media_usage_not_configured',
              'AI media editing is not connected for this workspace yet, so there is no usage to show.'
            )}
          </div>
        )}

        {data.state === 'unavailable' && (
          <div className="text-[13px] text-customColor18">
            {t(
              'media_usage_unavailable',
              "The usage figure can't be fetched right now. This does not affect your ability to use media editing — check back in a bit."
            )}
          </div>
        )}

        {data.state === 'ok' && <UsageBar usage={data.usage} />}
      </SectionCard>
    </div>
  );
};
