'use client';

import React, { useCallback } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// In bytes. `limit` is null when there is no cap (storage above `included`
// is paid from the wallet).
interface StorageUsage {
  used: number;
  limit: number | null;
  included: number | null;
}

export const useStorageUsage = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/media/storage')).json();
  }, []);
  return useSWR<StorageUsage>('media-storage-usage', load, {
    revalidateOnFocus: true,
    revalidateOnReconnect: false,
  });
};

// 1.25 GB, 340 MB, 12 KB.
const formatBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes || 0);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: unit >= 3 ? 2 : 0,
  })} ${units[unit]}`;
};

// How much of the media library's storage is used, and what to do when it
// is full. Files are counted while they are in the media library.
const StorageUsageComponent = () => {
  const t = useT();
  const { data, isLoading } = useStorageUsage();

  if (isLoading || !data || typeof data.used !== 'number') {
    return null;
  }

  const { used, limit, included } = data;
  const percent =
    limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = limit !== null && used >= limit;
  const nearlyFull = limit !== null && percent >= 90;

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[16px]">
      <div className="mt-[4px]">{t('storage_usage', 'Storage')}</div>
      <div className="text-[12px] text-textItemBlur">
        {t(
          'storage_usage_description',
          'Space used by the files in your media library, including files your agent uploaded.'
        )}
      </div>
      {limit !== null ? (
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center justify-between gap-[12px] text-[14px]">
            <div>
              {t('storage_usage_of', '{{used}} of {{limit}} used', {
                used: formatBytes(used),
                limit: formatBytes(limit),
              })}
            </div>
            <div className="text-textItemBlur">{percent}%</div>
          </div>
          <div className="h-[10px] rounded-[5px] bg-newBgColorInner border border-newBorder overflow-hidden">
            <div
              className={clsx(
                'h-full',
                nearlyFull ? 'bg-red-600' : 'bg-btnPrimary'
              )}
              style={{ width: `${Math.max(percent, used > 0 ? 1 : 0)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[4px] text-[14px]">
          <div>
            {t('storage_usage_used', '{{used}} used', {
              used: formatBytes(used),
            })}
          </div>
          <div className="text-[12px] text-textItemBlur">
            {t(
              'storage_usage_wallet',
              'The first {{included}} are included. Storage above that is paid from your wallet as you upload.',
              { included: formatBytes(included || 0) }
            )}
          </div>
        </div>
      )}
      {(full || nearlyFull) && (
        <div className="text-[13px]">
          {full
            ? t(
                'storage_usage_full',
                'Your media library is full, so new uploads are refused.'
              )
            : t(
                'storage_usage_nearly_full',
                'Your media library is nearly full.'
              )}{' '}
          {t(
            'storage_usage_free_up',
            'Delete files you no longer need to free up space, or upgrade for more storage.'
          )}
        </div>
      )}
      <div className="flex">
        <Link
          href="/media"
          className="text-[14px] font-[600] text-btnPrimary hover:underline"
        >
          {t('storage_usage_open_library', 'Open the media library')}
        </Link>
      </div>
    </div>
  );
};

export default StorageUsageComponent;
