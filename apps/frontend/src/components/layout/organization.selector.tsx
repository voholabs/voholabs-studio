'use client';

import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
export const OrganizationSelector: FC<{ asOpenSelect?: boolean }> = ({
  asOpenSelect,
}) => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    return await (await fetch('/user/organizations')).json();
  }, []);
  const { isLoading, data } = useSWR('organizations', load, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    revalidateOnReconnect: false,
  });
  const current = useMemo(() => {
    return data?.find((d: any) => d.id === user?.orgId);
  }, [data]);
  const changeOrg = useCallback(
    (org: { name: string; id: string }) => async () => {
      if (org.id === user?.orgId) {
        setOpen(false);
        return;
      }
      await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({
          id: org.id,
        }),
      });
      window.location.reload();
    },
    [user?.orgId]
  );
  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  if (isLoading || !data?.length || (asOpenSelect && data.length === 1)) {
    return null;
  }
  return (
    <>
      <div className="text-[12px] relative" ref={ref}>
        {asOpenSelect ? (
          <div className="bg-btnPrimary !flex !relative max-w-[500px] mx-auto py-[12px] px-[12px]">
            {t('select_organization', 'Select Organization')}
          </div>
        ) : (
          <div
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-[8px] h-[32px] px-[12px] rounded-[8px] border border-btnPrimary text-btnPrimary font-[600] transition-colors select-none cursor-pointer hover:bg-btnPrimary hover:text-white"
          >
            <span className="max-w-[180px] truncate">{current?.name}</span>
            <svg
              className={clsx(
                'transition-transform',
                open && 'rotate-180'
              )}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 9L12 15L18 9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
        {(open || asOpenSelect) && (
          <div
            className={clsx(
              'flex absolute top-[calc(100%+4px)] end-0 z-[200] min-w-[220px] flex-col overflow-hidden rounded-[8px] border border-btnPrimary bg-newBgColorInner shadow-lg',
              asOpenSelect
                ? '!flex !relative max-w-[500px] mx-auto mb-[10px] mt-[8px]'
                : ''
            )}
          >
            <div className="py-[8px] px-[12px] text-[11px] font-[600] uppercase tracking-wide text-textItemBlur border-b border-blockSeparator">
              {t('team', 'Team:')}
            </div>
            {data.map((org: { name: string; id: string }) => {
              const isCurrent = org.id === user?.orgId;
              return (
                <div
                  key={org.id}
                  onClick={changeOrg(org)}
                  className={clsx(
                    'flex items-center justify-between gap-[12px] py-[10px] px-[12px] transition-colors cursor-pointer',
                    isCurrent
                      ? 'text-btnPrimary font-[600]'
                      : 'hover:bg-boxFocused hover:text-textItemFocused'
                  )}
                >
                  <span className="truncate">{org.name}</span>
                  {isCurrent && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M20 6L9 17L4 12"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!asOpenSelect && <div className="w-[1px] h-[20px] bg-blockSeparator" />}
    </>
  );
};
