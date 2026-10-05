'use client';

import { FC, useCallback } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useWalletAccess } from '@gitroom/frontend/components/wallet-locks/wallet.access';

dayjs.extend(relativeTime);

type AgentConnection =
  | { connected: false }
  | {
      connected: true;
      client: string | null;
      authMethod: string | null;
      firstConnectedAt: string | null;
      lastSeenAt: string | null;
    };

const clientNames: Record<string, string> = {
  claude: 'Claude',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
  codex: 'Codex',
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
};

// Polls every 5 seconds while the panel is open and nothing has connected
// yet; stops once an agent shows up.
const useAgentConnection = (enabled: boolean) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      return (await res.json()) as AgentConnection;
    },
    [fetch]
  );
  return useSWR<AgentConnection>(
    enabled ? '/user/agent-connection' : null,
    load,
    {
      refreshInterval: (latest) => (latest?.connected ? 0 : 5000),
      revalidateOnFocus: true,
    }
  );
};

// Live "is my agent connected?" line for the connect-agent panel. Free and
// pay-as-you-go workspaces only; a paid plan sees nothing new.
export const AgentConnectionStatus: FC = () => {
  const access = useWalletAccess();
  const enabled = access === 'free' || access === 'payg';
  const { data } = useAgentConnection(enabled);
  const t = useT();

  if (!enabled || !data) {
    return null;
  }

  if (!data.connected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-[10px] rounded-[10px] border border-newBorder bg-newBgColorInner px-[14px] py-[10px] text-[13px] text-textItemBlur"
      >
        <span className="relative flex h-[8px] w-[8px] shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-textItemBlur opacity-60" />
          <span className="relative inline-flex h-[8px] w-[8px] rounded-full bg-textItemBlur" />
        </span>
        {t('agent_status_waiting', 'Waiting for your agent…')}
      </div>
    );
  }

  const client = data.client
    ? clientNames[data.client] ||
      (data.client === 'other' || data.client === 'unknown'
        ? t('agent_status_an_agent', 'an agent')
        : data.client)
    : t('agent_status_an_agent', 'an agent');

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] rounded-[10px] bg-posSoft px-[14px] py-[10px] text-[13px]"
    >
      <span className="flex items-center gap-[6px] font-[600] text-pos">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {t('agent_status_connected', 'Connected: {{client}}', { client })}
      </span>
      {data.lastSeenAt && (
        <span className="text-textItemBlur">
          {t('agent_status_last_seen', 'last seen {{time}}', {
            time: dayjs(data.lastSeenAt).fromNow(),
          })}
        </span>
      )}
    </div>
  );
};
