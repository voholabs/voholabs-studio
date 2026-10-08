'use client';

import React, { FC } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { isGrowthViewer } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/growth.viewer';

type GrowthWindow = '24h' | '7d' | '30d' | 'all';

interface FunnelRow {
  window: GrowthWindow;
  signups: number;
  activated: number;
  onboarded: number;
  channelConnected: number;
  mcpConnected: number;
  scheduledPost: number;
  toppedUp: number;
}

interface WindowCount {
  window: GrowthWindow;
  count: number;
}

interface GrowthResponse {
  generatedAt: string;
  funnel: FunnelRow[];
  organizations: {
    total: number;
    withChannel: number;
    withMcp: number;
    toppedUp: number;
    created: WindowCount[];
  };
  channels: {
    connected: number;
    disabled: number;
    removed: number;
    created: WindowCount[];
    perSocial: { provider: string; count: number }[];
  };
}

const WINDOWS: { key: GrowthWindow; label: string }[] = [
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
];

const STEPS: { key: keyof Omit<FunnelRow, 'window'>; label: string }[] = [
  { key: 'signups', label: 'Signed up' },
  { key: 'activated', label: 'Activated' },
  { key: 'onboarded', label: 'Onboarding done' },
  { key: 'channelConnected', label: 'Channel connected' },
  { key: 'mcpConnected', label: 'MCP connected' },
  { key: 'scheduledPost', label: 'Scheduled a post' },
  { key: 'toppedUp', label: 'Topped up' },
];

const useGrowth = (enabled: boolean) => {
  const fetch = useFetch();
  return useSWR<GrowthResponse>(
    enabled ? '/admin/growth' : null,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load growth numbers');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '–';

const SummaryCard: FC<{ label: string; value: number; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="border border-newTableBorder rounded-[8px] p-[16px] bg-newBgColorInner">
    <div className="text-[12px] opacity-70">{label}</div>
    <div className="text-[28px] font-[600]">{value.toLocaleString()}</div>
    {hint && <div className="text-[12px] opacity-70">{hint}</div>}
  </div>
);

const FunnelTable: FC<{ funnel: FunnelRow[] }> = ({ funnel }) => {
  const byWindow = new Map(funnel.map((row) => [row.window, row]));
  return (
    <div className="border border-newTableBorder rounded-[8px] overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
          <div>Step</div>
          {WINDOWS.map((w) => (
            <div key={w.key} className="text-right">
              {w.label}
            </div>
          ))}
        </div>
        {STEPS.map((step) => (
          <div
            key={step.key}
            className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
          >
            <div>{step.label}</div>
            {WINDOWS.map((w) => {
              const row = byWindow.get(w.key);
              const value = row?.[step.key] || 0;
              return (
                <div key={w.key} className="text-right">
                  <span className="font-[600]">{value.toLocaleString()}</span>
                  {step.key !== 'signups' && (
                    <span className="opacity-60 ms-[6px]">
                      {percent(value, row?.signups || 0)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const NewPerWindow: FC<{ title: string; rows: WindowCount[] }> = ({
  title,
  rows,
}) => (
  <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
    <div className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
      <div>{title}</div>
      <div className="text-right">Count</div>
    </div>
    {WINDOWS.map((w) => (
      <div
        key={w.key}
        className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
      >
        <div>{w.label}</div>
        <div className="text-right">
          {(rows.find((r) => r.window === w.key)?.count || 0).toLocaleString()}
        </div>
      </div>
    ))}
  </div>
);

const PerSocialTable: FC<{
  rows: { provider: string; count: number }[];
}> = ({ rows }) => (
  <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
    <div className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
      <div>Connected channels per social</div>
      <div className="text-right">Count</div>
    </div>
    {rows.length === 0 ? (
      <div className="px-[12px] py-[10px] text-[13px] opacity-70">
        No channels connected.
      </div>
    ) : (
      rows.map((row) => (
        <div
          key={row.provider}
          className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
        >
          <div className="capitalize">{row.provider}</div>
          <div className="text-right">{row.count.toLocaleString()}</div>
        </div>
      ))
    )}
  </div>
);

export const AdminGrowthComponent: FC = () => {
  const user = useUser();
  const allowed = isGrowthViewer(user?.email) && !user?.impersonate;
  const { data, isLoading, error } = useGrowth(allowed);

  if (!allowed) {
    return (
      <div className="text-textColor p-[20px]">
        You do not have access to this page.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <div className="flex items-center justify-between">
        <div className="text-[20px] font-[600]">Growth</div>
        {data && (
          <div className="text-[13px] opacity-70">
            Updated {new Date(data.generatedAt).toLocaleString()}
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingComponent />
      ) : error || !data ? (
        <div className="text-red-400">Failed to load growth numbers.</div>
      ) : (
        <>
          <div className="flex flex-col gap-[6px]">
            <div className="text-[16px] font-[600]">Sign-up funnel</div>
            <div className="text-[13px] opacity-70">
              People who signed up in each period, and how many of them have
              reached each step since. Percentages are of sign-ups. Steps after
              onboarding count the workspaces the person owns, not ones they
              were invited to.
            </div>
          </div>
          <FunnelTable funnel={data.funnel} />

          <div className="text-[16px] font-[600] mt-[8px]">Organizations</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
            <SummaryCard label="Total" value={data.organizations.total} />
            <SummaryCard
              label="With a connected channel"
              value={data.organizations.withChannel}
              hint={percent(
                data.organizations.withChannel,
                data.organizations.total
              )}
            />
            <SummaryCard
              label="With MCP connected"
              value={data.organizations.withMcp}
              hint={percent(data.organizations.withMcp, data.organizations.total)}
            />
            <SummaryCard
              label="Topped up"
              value={data.organizations.toppedUp}
              hint={percent(
                data.organizations.toppedUp,
                data.organizations.total
              )}
            />
          </div>

          <div className="text-[16px] font-[600] mt-[8px]">Channels</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
            <SummaryCard label="Connected" value={data.channels.connected} />
            <SummaryCard
              label="Disabled"
              value={data.channels.disabled}
              hint="Still connected, switched off"
            />
            <SummaryCard
              label="Removed"
              value={data.channels.removed}
              hint="Disconnected since joining"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
            <NewPerWindow
              title="New organizations"
              rows={data.organizations.created}
            />
            <NewPerWindow
              title="New channels (still connected)"
              rows={data.channels.created}
            />
            <PerSocialTable rows={data.channels.perSocial} />
          </div>
        </>
      )}
    </div>
  );
};
