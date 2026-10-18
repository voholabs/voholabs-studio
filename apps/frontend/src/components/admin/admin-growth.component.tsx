'use client';

import React, { FC, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { fractionDigits } from '@gitroom/frontend/components/wallet/wallet.hooks';

type GrowthWindow = '24h' | '7d' | '30d' | 'all';

interface FunnelRow {
  window: GrowthWindow;
  signups: number;
  activated: number;
  onboarded: number;
  channelConnected: number;
  mcpConnected: number;
  watchedTutorial: number;
  finishedTutorial: number;
  scheduledPost: number;
  toppedUp: number;
}

interface WindowCount {
  window: GrowthWindow;
  count: number;
}

interface ActiveUsers {
  since: string | null;
  today: number;
  weekly: number;
  monthly: number;
  days: { day: string; users: number }[];
}

interface ActiveAgents {
  since: string | null;
  today: number;
  weekly: number;
  monthly: number;
  days: {
    day: string;
    organizations: number;
    byClient: Record<string, number>;
  }[];
  clients: { client: string; monthly: number; allTime: number }[];
}

interface MoneyFunnelRow {
  window: GrowthWindow;
  signups: number;
  claimedCredits: number;
  skippedCredits: number;
  spentCredits: number;
  subscribed: number;
  subscribedMonthly: number;
  subscribedAnnual: number;
  subscribedNow: number;
}

interface Amount {
  currency: string;
  amount: number;
}

interface GrowthMoney {
  funnel: MoneyFunnelRow[];
  plus: {
    active: number;
    monthly: number;
    annual: number;
    cancelling: number;
    pastDue: number;
    comped: number;
    mrr: Amount[];
    mrrSource: 'stripe' | 'settings';
  };
  earlyBird: { window: GrowthWindow; issued: number; converted: number }[];
  credits: {
    window: GrowthWindow;
    welcome: number;
    plan: number;
    topUp: number;
    spent: number;
    expired: number;
    topUpRevenue: Amount[];
  }[];
  legacy: { total: number; open: number; onPlus: number; spentLast30d: number };
  topActions: {
    actionKey: string;
    name: string;
    monthly: { credits: number; charges: number };
    allTime: { credits: number; charges: number };
  }[];
}

interface GrowthResponse {
  generatedAt: string;
  money: GrowthMoney;
  funnel: FunnelRow[];
  activeUsers: ActiveUsers;
  activeAgents: ActiveAgents;
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
  { key: 'watchedTutorial', label: 'Watched tutorial' },
  { key: 'finishedTutorial', label: 'Watched 90%+ of tutorial' },
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

// Amounts in the smallest unit of their currency, one per currency.
export const moneyText = (amounts: Amount[]) =>
  amounts.length
    ? amounts
        .map(({ currency, amount }) => {
          const value = amount / Math.pow(10, fractionDigits(currency));
          // Decimals only when there are any: "$37.10", "$19"
          const digits = Number.isInteger(value) ? 0 : fractionDigits(currency);
          try {
            return value.toLocaleString(undefined, {
              style: 'currency',
              currency,
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            });
          } catch {
            return `${value.toLocaleString()} ${currency}`;
          }
        })
        .join(' + ')
    : '–';

const creditsText = (credits: number) =>
  credits.toLocaleString(undefined, { maximumFractionDigits: 2 });

const SummaryCard: FC<{
  label: string;
  value: number | string;
  hint?: string;
}> = ({ label, value, hint }) => (
  <div className="border border-newTableBorder rounded-[8px] p-[16px] bg-newBgColorInner">
    <div className="text-[12px] opacity-70">{label}</div>
    <div className="text-[28px] font-[600]">
      {typeof value === 'number' ? value.toLocaleString() : value}
    </div>
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

// A table with a column per window, like the sign-up funnel. A row with
// percentOf shows its value as a share of that number too; hint is a second
// line under the value.
interface WindowRow {
  key: string;
  label: string;
  value: (window: GrowthWindow) => number | string;
  percentOf?: (window: GrowthWindow) => number;
  hint?: (window: GrowthWindow) => string;
}

const WindowTable: FC<{ rows: WindowRow[] }> = ({ rows }) => (
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
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
        >
          <div>{row.label}</div>
          {WINDOWS.map((w) => {
            const value = row.value(w.key);
            const hint = row.hint?.(w.key);
            return (
              <div key={w.key} className="text-right">
                <span className="font-[600]">
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </span>
                {row.percentOf && typeof value === 'number' && (
                  <span className="opacity-60 ms-[6px]">
                    {percent(value, row.percentOf(w.key))}
                  </span>
                )}
                {hint && <div className="text-[12px] opacity-60">{hint}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  </div>
);

// Signed up, then each money step as a share of the step before it.
export const moneyFunnelRows = (funnel: MoneyFunnelRow[]): WindowRow[] => {
  const row = (w: GrowthWindow) =>
    funnel.find((r) => r.window === w) || ({} as Partial<MoneyFunnelRow>);
  return [
    {
      key: 'signups',
      label: 'Signed up',
      value: (w) => row(w).signups || 0,
    },
    {
      key: 'claimed',
      label: 'Claimed free credits',
      value: (w) => row(w).claimedCredits || 0,
      percentOf: (w) => row(w).signups || 0,
      hint: (w) => `${(row(w).skippedCredits || 0).toLocaleString()} skipped`,
    },
    {
      key: 'spent',
      label: 'Spent credits',
      value: (w) => row(w).spentCredits || 0,
      percentOf: (w) => row(w).claimedCredits || 0,
    },
    {
      key: 'subscribed',
      label: 'Subscribed to Plus',
      value: (w) => row(w).subscribed || 0,
      percentOf: (w) => row(w).spentCredits || 0,
      hint: (w) =>
        `${(row(w).subscribedMonthly || 0).toLocaleString()} monthly · ${(
          row(w).subscribedAnnual || 0
        ).toLocaleString()} annual · ${(
          row(w).subscribedNow || 0
        ).toLocaleString()} active now`,
    },
  ];
};

const TopActionsTable: FC<{ actions: GrowthMoney['topActions'] }> = ({
  actions,
}) => (
  <div className="border border-newTableBorder rounded-[8px] overflow-x-auto">
    <div className="min-w-[560px]">
      <div className="grid grid-cols-[1fr_110px_80px_110px_80px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
        <div>Action</div>
        <div className="text-right">Credits, 30 days</div>
        <div className="text-right">Uses</div>
        <div className="text-right">Credits, ever</div>
        <div className="text-right">Uses</div>
      </div>
      {actions.map((a) => (
        <div
          key={a.actionKey}
          className="grid grid-cols-[1fr_110px_80px_110px_80px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
        >
          <div className="min-w-0">
            <div className="truncate">{a.name}</div>
            <div className="text-[12px] opacity-60 truncate">{a.actionKey}</div>
          </div>
          <div className="text-right font-[600]">
            {creditsText(a.monthly.credits)}
          </div>
          <div className="text-right opacity-70">
            {a.monthly.charges.toLocaleString()}
          </div>
          <div className="text-right">{creditsText(a.allTime.credits)}</div>
          <div className="text-right opacity-70">
            {a.allTime.charges.toLocaleString()}
          </div>
        </div>
      ))}
      {!actions.length && (
        <div className="px-[12px] py-[10px] text-[13px] opacity-70">
          Nothing has been spent yet.
        </div>
      )}
    </div>
  </div>
);

const MoneySection: FC<{ money: GrowthMoney }> = ({ money }) => {
  const credits = (w: GrowthWindow) =>
    money.credits.find((r) => r.window === w);
  const early = (w: GrowthWindow) =>
    money.earlyBird.find((r) => r.window === w);
  const { plus, legacy } = money;
  return (
    <>
      <div className="flex flex-col gap-[6px] mt-[8px]">
        <div className="text-[16px] font-[600]">Money funnel</div>
        <div className="text-[13px] opacity-70">
          The same sign-ups, and how many of their workspaces claimed the free
          credits, spent credits and subscribed to Plus (ever, even if it has
          ended). Each percentage is of the step above.
        </div>
      </div>
      <WindowTable rows={moneyFunnelRows(money.funnel)} />

      <div className="flex flex-col gap-[6px] mt-[8px]">
        <div className="text-[16px] font-[600]">Plus now</div>
        <div className="text-[13px] opacity-70">
          Subscriptions active today. MRR is the monthly price of each monthly
          subscription plus a twelfth of each annual one, leaving out comped
          ones (a discount takes all of it).
          {plus.mrrSource === 'settings' &&
            ' Stripe could not be read for some of them, so their price is taken from the Plus settings.'}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px]">
        <SummaryCard
          label="Active subscribers"
          value={plus.active}
          hint={`${plus.monthly.toLocaleString()} monthly · ${plus.annual.toLocaleString()} annual`}
        />
        <SummaryCard label="MRR" value={moneyText(plus.mrr)} />
        <SummaryCard
          label="Comped"
          value={plus.comped}
          hint="Active, not paying"
        />
        <SummaryCard
          label="Cancelling"
          value={plus.cancelling}
          hint="Active, ends at the period end"
        />
        <SummaryCard
          label="Past due"
          value={plus.pastDue}
          hint="Payment failed, Stripe retrying"
        />
      </div>

      <div className="flex flex-col gap-[6px] mt-[8px]">
        <div className="text-[16px] font-[600]">Early bird</div>
        <div className="text-[13px] opacity-70">
          Workspaces given an early-bird code, by when their early bird started
          (the free credits claim, or the skip), and how many of them went on
          to subscribe.
        </div>
      </div>
      <WindowTable
        rows={[
          {
            key: 'issued',
            label: 'Codes issued',
            value: (w) => early(w)?.issued || 0,
          },
          {
            key: 'converted',
            label: 'Subscribed',
            value: (w) => early(w)?.converted || 0,
            percentOf: (w) => early(w)?.issued || 0,
          },
        ]}
      />

      <div className="flex flex-col gap-[6px] mt-[8px]">
        <div className="text-[16px] font-[600]">Credits</div>
        <div className="text-[13px] opacity-70">
          Wallet entries made in each period, in credits. Spent is charges less
          their refunds; expired is plan credits left at the end of a plan
          period. Top-up revenue is what was paid before tax.
        </div>
      </div>
      <WindowTable
        rows={[
          {
            key: 'welcome',
            label: 'Welcome credits granted',
            value: (w) => creditsText(credits(w)?.welcome || 0),
          },
          {
            key: 'plan',
            label: 'Plan credits granted',
            value: (w) => creditsText(credits(w)?.plan || 0),
          },
          {
            key: 'topUp',
            label: 'Top-up credits',
            value: (w) => creditsText(credits(w)?.topUp || 0),
          },
          {
            key: 'spent',
            label: 'Credits spent',
            value: (w) => creditsText(credits(w)?.spent || 0),
          },
          {
            key: 'expired',
            label: 'Plan credits expired',
            value: (w) => creditsText(credits(w)?.expired || 0),
          },
          {
            key: 'revenue',
            label: 'Top-up revenue',
            value: (w) => moneyText(credits(w)?.topUpRevenue || []),
          },
        ]}
      />

      <div className="flex flex-col gap-[6px] mt-[8px]">
        <div className="text-[16px] font-[600]">
          Pay-as-you-go from before Plus
        </div>
        <div className="text-[13px] opacity-70">
          Workspaces whose first top-up came before Plus launched. They keep
          pay-as-you-go while their wallet is not on hold.
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
        <SummaryCard label="Total" value={legacy.total} />
        <SummaryCard
          label="Still open"
          value={legacy.open}
          hint={percent(legacy.open, legacy.total)}
        />
        <SummaryCard
          label="Now on Plus"
          value={legacy.onPlus}
          hint={percent(legacy.onPlus, legacy.total)}
        />
        <SummaryCard
          label="Spent in last 30 days"
          value={legacy.spentLast30d}
          hint={percent(legacy.spentLast30d, legacy.total)}
        />
      </div>

      <div className="flex flex-col gap-[6px] mt-[8px]">
        <div className="text-[16px] font-[600]">Top spending actions</div>
        <div className="text-[13px] opacity-70">
          What credits are spent on: net credits (charges less refunds) and
          uses (free ones included) per action, the ten with the most spent in
          the last 30 days.
        </div>
      </div>
      <TopActionsTable actions={money.topActions} />
    </>
  );
};

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

// A step for the y-axis that gives three or four gridlines.
const niceStep = (max: number) => {
  const raw = Math.max(1, max) / 3;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * power).find((m) => m >= raw);
  return Math.max(1, Math.ceil(step || raw));
};

// Daily active users as bars, oldest on the left. One series, so no legend:
// the heading names it. Hovering a bar shows its day and count.
// A bar may be split into colored segments (one per agent); the bar's height
// is then the sum of its segments.
type ChartDay = {
  day: string;
  users: number;
  segments?: { key: string; label: string; value: number; color: string }[];
};

const barTotal = (d: ChartDay) =>
  d.segments
    ? d.segments.reduce((sum, segment) => sum + segment.value, 0)
    : d.users;

const DailyActiveChart: FC<{ days: ChartDay[] }> = ({ days }) => {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(0, ...days.map(barTotal));
  const step = niceStep(peak);
  const top = Math.max(step, Math.ceil(peak / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) {
    ticks.push(v);
  }
  const labelEvery = Math.ceil(days.length / 6);
  const hovered = hover === null ? null : days[hover];

  return (
    <div className="border border-newTableBorder rounded-[8px] p-[16px] bg-newBgColorInner">
      <div className="flex gap-[8px]">
        <div className="relative w-[32px] h-[200px] text-[11px] opacity-60">
          {ticks.map((v) => (
            <div
              key={v}
              className="absolute end-0"
              style={{
                bottom: `${(v / top) * 100}%`,
                transform: 'translateY(50%)',
              }}
            >
              {v}
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative h-[200px]">
            {ticks.map((v) => (
              <div
                key={v}
                className="absolute inset-x-0 border-t border-newTableBorder"
                style={{ bottom: `${(v / top) * 100}%` }}
              />
            ))}
            <div
              className="absolute inset-0 flex items-end gap-[2px]"
              onMouseLeave={() => setHover(null)}
            >
              {days.map((d, i) => (
                <div
                  key={d.day}
                  className="relative flex-1 h-full flex items-end cursor-default"
                  onMouseEnter={() => setHover(i)}
                >
                  {d.segments ? (
                    <div
                      className={`w-full flex flex-col-reverse rounded-t-[4px] overflow-hidden transition-opacity ${
                        hover === null || hover === i ? '' : 'opacity-50'
                      }`}
                      style={{
                        height: `${(barTotal(d) / top) * 100}%`,
                        minHeight: barTotal(d) ? '2px' : 0,
                      }}
                    >
                      {d.segments.map((segment) => (
                        <div
                          key={segment.key}
                          className={segment.color}
                          style={{ flexGrow: segment.value }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`w-full rounded-t-[4px] bg-btnPrimary transition-opacity ${
                        hover === null || hover === i ? '' : 'opacity-50'
                      }`}
                      style={{
                        height: `${(d.users / top) * 100}%`,
                        minHeight: d.users ? '2px' : 0,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            {hovered && (
              <div
                className="absolute -top-[8px] z-[1] pointer-events-none bg-newBgColor border border-newTableBorder rounded-[8px] px-[10px] py-[6px] text-[12px] whitespace-nowrap shadow"
                style={{
                  left: `${((hover! + 0.5) / days.length) * 100}%`,
                  // Kept inside the chart at either end
                  transform: `translate(${
                    hover! < days.length / 6
                      ? '0'
                      : hover! > (days.length * 5) / 6
                      ? '-100%'
                      : '-50%'
                  }, -100%)`,
                }}
              >
                <div className="opacity-70">{dayLabel(hovered.day)}</div>
                <div className="font-[600]">
                  {hovered.users.toLocaleString()} active
                </div>
                {hovered.segments
                  ?.filter((segment) => segment.value)
                  .map((segment) => (
                    <div
                      key={segment.key}
                      className="flex items-center gap-[6px]"
                    >
                      <span
                        className={`w-[8px] h-[8px] rounded-[2px] ${segment.color}`}
                      />
                      {segment.label}: {segment.value.toLocaleString()}
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div className="flex gap-[2px] mt-[6px] text-[11px] opacity-60">
            {days.map((d, i) => (
              <div key={d.day} className="flex-1 text-center whitespace-nowrap overflow-visible">
                {i % labelEvery === 0 || i === days.length - 1
                  ? dayLabel(d.day)
                  : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Readable names for AgentConnection.client
const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
  codex: 'Codex (incl. ChatGPT Work)',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  vscode: 'VS Code',
  cline: 'Cline',
  gemini: 'Gemini',
  n8n: 'n8n',
  hermes: 'Hermes',
  goose: 'Goose',
  zed: 'Zed',
  inspector: 'MCP Inspector',
  other: 'Other',
  unknown: 'Unknown',
};
const agentName = (client: string) => AGENT_NAMES[client] || client;

// The five most used agents get their own color; the rest share one.
const AGENT_COLORS = [
  'bg-btnPrimary',
  'bg-warm',
  'bg-pos',
  'bg-danger',
  'bg-ai',
];
const OTHER_COLOR = 'bg-textItemBlur';

const agentColors = (clients: ActiveAgents['clients']) => {
  const colors = new Map<string, string>();
  clients
    .slice(0, AGENT_COLORS.length)
    .forEach((c, i) => colors.set(c.client, AGENT_COLORS[i]));
  return (client: string) => colors.get(client) || OTHER_COLOR;
};

const agentChartDays = (agents: ActiveAgents) => {
  const colorOf = agentColors(agents.clients);
  return agents.days.map((d) => ({
    day: d.day,
    users: d.organizations,
    segments: Object.entries(d.byClient)
      .sort((a, b) => b[1] - a[1])
      .map(([client, value]) => ({
        key: client,
        label: agentName(client),
        value,
        color: colorOf(client),
      })),
  }));
};

const AgentsTable: FC<{ agents: ActiveAgents }> = ({ agents }) => {
  const colorOf = agentColors(agents.clients);
  return (
    <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
      <div className="grid grid-cols-[1fr_110px_70px_110px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
        <div>Agent</div>
        <div className="text-right">Last 30 days</div>
        <div className="text-right">Share</div>
        <div className="text-right">Ever</div>
      </div>
      {agents.clients.map((c) => (
        <div
          key={c.client}
          className="grid grid-cols-[1fr_110px_70px_110px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
        >
          <div className="flex items-center gap-[8px] min-w-0">
            <span
              className={`shrink-0 w-[10px] h-[10px] rounded-[3px] ${colorOf(
                c.client
              )}`}
            />
            <span className="truncate">{agentName(c.client)}</span>
          </div>
          <div className="text-right font-[600]">
            {c.monthly.toLocaleString()}
          </div>
          <div className="text-right opacity-70">
            {percent(c.monthly, agents.monthly)}
          </div>
          <div className="text-right">{c.allTime.toLocaleString()}</div>
        </div>
      ))}
      {!agents.clients.length && (
        <div className="px-[12px] py-[10px] text-[13px] opacity-70">
          No agent has connected yet.
        </div>
      )}
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
  const allowed = !!user?.growthViewer;
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
          <MoneySection money={data.money} />

          <div className="flex flex-col gap-[6px] mt-[8px]">
            <div className="text-[16px] font-[600]">Daily active users</div>
            <div className="text-[13px] opacity-70">
              People who used the app while signed in, per day (UTC).
              {data.activeUsers.since
                ? ` Recorded since ${dayLabel(data.activeUsers.since)}.`
                : ' Recording starts now, so the chart fills in from today.'}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
            <SummaryCard label="Today" value={data.activeUsers.today} />
            <SummaryCard
              label="Last 7 days"
              value={data.activeUsers.weekly}
              hint="Distinct people"
            />
            <SummaryCard
              label="Last 30 days"
              value={data.activeUsers.monthly}
              hint="Distinct people"
            />
          </div>
          <DailyActiveChart days={data.activeUsers.days} />

          <div className="flex flex-col gap-[6px] mt-[8px]">
            <div className="text-[16px] font-[600]">Daily active agents</div>
            <div className="text-[13px] opacity-70">
              Workspaces whose AI agent (Claude, ChatGPT, ...) used Studio's
              tools over the MCP, per day (UTC). Separate from the people above:
              this is work done through an agent, not by signing in to the app.
              {data.activeAgents.since
                ? ` Recorded since ${dayLabel(data.activeAgents.since)}.`
                : ' Recording starts now, so the chart fills in from today.'}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
            <SummaryCard label="Today" value={data.activeAgents.today} />
            <SummaryCard
              label="Last 7 days"
              value={data.activeAgents.weekly}
              hint="Distinct workspaces"
            />
            <SummaryCard
              label="Last 30 days"
              value={data.activeAgents.monthly}
              hint="Distinct workspaces"
            />
          </div>
          <DailyActiveChart days={agentChartDays(data.activeAgents)} />

          <div className="flex flex-col gap-[6px] mt-[8px]">
            <div className="text-[16px] font-[600]">Agents by app</div>
            <div className="text-[13px] opacity-70">
              Which agents people use: workspaces that used Studio through each
              one in the last 30 days, its share of all agent workspaces in that
              time (a workspace using two agents counts for both), and how many
              workspaces ever connected it. ChatGPT&apos;s Work mode shows up as
              Codex.
            </div>
          </div>
          <AgentsTable agents={data.activeAgents} />

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
