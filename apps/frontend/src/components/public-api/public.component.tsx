'use client';

import { useState, useCallback, useEffect, useRef, FC, ReactNode } from 'react';
import { useSWRConfig } from 'swr';
import { useUser } from '../layout/user.context';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { McpClientIcon } from '@gitroom/frontend/components/public-api/mcp.client.icons';
import clsx from 'clsx';
import { useWalletAccess } from '@gitroom/frontend/components/wallet-locks/wallet.access';
import { LegacyPublicComponent } from '@gitroom/frontend/components/public-api/public.component.legacy';
import { AgentConnectionStatus } from '@gitroom/frontend/components/public-api/agent.connection.status';

const mcpClients = [
  'Claude Code',
  'Cursor',
  'Codex',
  'OpenClaw',
  'Hermes',
  'NanoClaw',
  'VS Code / Copilot',
  'Windsurf',
  'Amp',
  'Gemini CLI',
  'Warp',
] as const;

type McpClient = (typeof mcpClients)[number];

// sign-in: OAuth on the /mcp-oauth endpoint. The client registers itself and
// the person signs in to Studio and picks a workspace, so there is no key to
// copy. apikey: the workspace API key, as a header (or inside the URL).
type McpAuth = 'oauth' | 'apikey';

// Distinct registration name so adding this MCP doesn't overwrite an existing
// "postiz" server (or CLI) the user may already have configured.
const MCP_SERVER_NAME = 'voholabs';

const getMcpOauthUrl = (mcpBase: string) => `${mcpBase}/mcp-oauth`;

// Coding agents read the key from an Authorization header, so they all point at
// the plain /mcp endpoint. Chat apps (Claude, ChatGPT) cannot set headers, so
// they use the /mcp/<key> form instead — see connectorUrl below. Signing in
// needs neither: every client points at the sign-in endpoint.
const getMcpConfig = (
  client: McpClient,
  auth: McpAuth,
  mcpBase: string,
  apiKey: string
): { config: string; hint: string } => {
  const serverName = MCP_SERVER_NAME;
  const json = (obj: object) => JSON.stringify(obj, null, 2);

  if (auth === 'oauth') {
    const oauthUrl = getMcpOauthUrl(mcpBase);
    switch (client) {
      case 'Claude Code':
        return {
          config: `claude mcp add --transport http ${serverName} ${oauthUrl}`,
          hint: 'Run this in your terminal, then type /mcp in Claude Code and pick Authenticate.',
        };
      case 'Cursor':
        return {
          config: json({ mcpServers: { [serverName]: { url: oauthUrl } } }),
          hint: 'Add to .cursor/mcp.json in your project root.',
        };
      case 'VS Code / Copilot':
        return {
          config: json({
            servers: { [serverName]: { type: 'http', url: oauthUrl } },
          }),
          hint: 'Add to .vscode/mcp.json in your project root.',
        };
      case 'Windsurf':
        return {
          config: json({
            mcpServers: { [serverName]: { serverUrl: oauthUrl } },
          }),
          hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
        };
      case 'Amp':
        return {
          config: `amp mcp add ${serverName} ${oauthUrl}`,
          hint: 'Run this command in your terminal.',
        };
      case 'Codex':
        return {
          config: `codex mcp add ${serverName} --url ${oauthUrl}`,
          hint: `Run this in your terminal. If no sign-in page opens, run: codex mcp login ${serverName}`,
        };
      case 'Gemini CLI':
        return {
          config: json({ mcpServers: { [serverName]: { url: oauthUrl } } }),
          hint: 'Add to ~/.gemini/settings.json',
        };
      case 'Warp':
        return {
          config: json({ [serverName]: { url: oauthUrl } }),
          hint: 'Settings > MCP Servers > + Add, then paste this config.',
        };
      case 'Hermes':
        return {
          config: `# ~/.hermes/config.yaml\n\nmcp_servers:\n  ${serverName}:\n    url: "${oauthUrl}"\n    auth: oauth`,
          hint: 'Add to ~/.hermes/config.yaml, then run /reload-mcp in the chat.',
        };
      case 'OpenClaw':
        return {
          config: `openclaw mcp add ${serverName} --url ${oauthUrl} --transport streamable-http --auth oauth && openclaw mcp login ${serverName}`,
          hint: 'Run this command in your terminal.',
        };
      case 'NanoClaw':
        return {
          config: `ncl groups config add-mcp-server --id <group-id> --name ${serverName} --url ${oauthUrl}`,
          hint: 'Run this in your terminal, replace <group-id> with the agent group that should get Voholabs Studio.',
        };
    }
  }

  const urlBase = `${mcpBase}/mcp`;
  const bearer = `Bearer ${apiKey}`;

  switch (client) {
    case 'Claude Code':
      return {
        config: `claude mcp add --transport http ${serverName} ${urlBase} --header "Authorization: ${bearer}"`,
        hint: 'Run this command in your terminal.',
      };
    case 'Cursor':
      return {
        config: json({
          mcpServers: {
            [serverName]: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to .cursor/mcp.json in your project root.',
      };
    case 'VS Code / Copilot':
      return {
        config: json({
          servers: {
            [serverName]: {
              type: 'http',
              url: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to .vscode/mcp.json in your project root.',
      };
    case 'Windsurf':
      return {
        config: json({
          mcpServers: {
            [serverName]: {
              serverUrl: urlBase,
              headers: { Authorization: bearer },
            },
          },
        }),
        hint: 'Add to ~/.codeium/windsurf/mcp_config.json',
      };
    case 'Amp':
      return {
        config: json({
          'amp.mcpServers': {
            [serverName]: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to your Amp settings.json',
      };
    case 'Codex':
      return {
        config: `# ~/.codex/config.toml\n\n[mcp_servers.${serverName}]\nurl = "${urlBase}"\nhttp_headers = { "Authorization" = "${bearer}" }`,
        hint: 'Add to ~/.codex/config.toml',
      };
    case 'Gemini CLI':
      return {
        config: json({
          mcpServers: {
            [serverName]: { url: urlBase, headers: { Authorization: bearer } },
          },
        }),
        hint: 'Add to ~/.gemini/settings.json',
      };
    case 'Warp':
      return {
        config: json({
          [serverName]: { url: urlBase, headers: { Authorization: bearer } },
        }),
        hint: 'Settings > MCP Servers > + Add, then paste this config.',
      };
    case 'Hermes':
      return {
        config: `# ~/.hermes/config.yaml\n\nmcp_servers:\n  ${serverName}:\n    url: "${urlBase}"\n    headers:\n      Authorization: "${bearer}"`,
        hint: 'Add to ~/.hermes/config.yaml, then run /reload-mcp in the chat.',
      };
    case 'OpenClaw':
      return {
        config: json({
          mcp: {
            servers: {
              [serverName]: {
                url: urlBase,
                transport: 'streamable-http',
                headers: { Authorization: bearer },
              },
            },
          },
        }),
        hint: 'Add to ~/.openclaw/openclaw.json',
      };
    case 'NanoClaw':
      // No headers flag, so the key travels inside the URL like the chat apps.
      return {
        config: `ncl groups config add-mcp-server --id <group-id> --name ${serverName} --url ${mcpBase}/mcp/${apiKey}`,
        hint: 'Run this in your terminal, replace <group-id> with the agent group that should get Voholabs Studio.',
      };
  }
};

// One click for clients that install an MCP server from a link. Sign-in only,
// so the API key never travels inside a link.
const getMcpInstallLink = (client: McpClient, mcpBase: string) => {
  const url = getMcpOauthUrl(mcpBase);
  switch (client) {
    case 'Cursor':
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(
        btoa(JSON.stringify({ url }))
      )}`;
    case 'VS Code / Copilot':
      return `vscode:mcp/install?${encodeURIComponent(
        JSON.stringify({ name: MCP_SERVER_NAME, type: 'http', url })
      )}`;
    default:
      return null;
  }
};

const maskKey = (text: string, apiKey: string) =>
  text.split(apiKey).join('••••••••••••••••••••');

const CopyButton = ({
  text,
  label,
  primary,
}: {
  text: string;
  label: string;
  primary?: boolean;
}) => {
  const toaster = useToaster();
  return (
    <button
      type="button"
      onClick={() => {
        copy(text);
        toaster.show(`${label} copied to clipboard`, 'success');
      }}
      className={clsx(
        'cursor-pointer px-[16px] h-[36px] transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]',
        primary
          ? 'bg-btnPrimary hover:brightness-110 text-white'
          : 'bg-btnSimple hover:bg-boxHover'
      )}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </svg>
      {label}
    </button>
  );
};

const RevealButton = ({
  revealed,
  onClick,
}: {
  revealed: boolean;
  onClick: () => void;
}) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {revealed ? (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        ) : (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
      {revealed ? t('hide', 'Hide') : t('reveal', 'Reveal')}
    </button>
  );
};

const CodeBlock: FC<{ children: ReactNode }> = ({ children }) => (
  <pre className="bg-newBgColorInner border border-newBorder rounded-[8px] p-[16px] text-[13px] whitespace-pre-wrap break-all overflow-x-auto leading-[1.6]">
    {children}
  </pre>
);

const SectionCard: FC<{
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}> = ({ title, description, actions, children }) => (
  <div className="bg-newBgColorInnerInner rounded-[12px] border border-newBorder overflow-hidden">
    <div className="bg-newBgColorInner px-[20px] mobile:px-[14px] py-[14px] border-b border-newBorder flex items-start justify-between gap-[12px] mobile:flex-col">
      <div>
        <div className="text-[15px] font-[600]">{title}</div>
        <div className="text-[13px] text-textItemBlur mt-[2px]">
          {description}
        </div>
      </div>
      {!!actions && (
        <div className="flex flex-wrap gap-[6px] shrink-0 pt-[2px]">
          {actions}
        </div>
      )}
    </div>
    <div className="p-[20px] mobile:p-[14px] flex flex-col gap-[16px]">
      {children}
    </div>
  </div>
);

const DocsLink = ({ href, label }: { href: string; label: string }) => (
  <a
    className="cursor-pointer px-[16px] h-[36px] bg-btnPrimary hover:brightness-110 text-white transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
    href={href}
    target="_blank"
    rel="noreferrer"
  >
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
    {label}
  </a>
);

const Tabs = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="flex flex-wrap gap-[6px]">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        className={clsx(
          'cursor-pointer px-[14px] h-[36px] text-[13px] font-[500] rounded-[8px] transition-colors flex items-center gap-[8px]',
          value === option.value
            ? 'bg-btnPrimary text-white'
            : 'bg-btnSimple text-textItemBlur hover:bg-boxHover hover:text-textColor'
        )}
        onClick={() => onChange(option.value)}
      >
        {option.icon}
        {option.label}
      </button>
    ))}
  </div>
);

const CopyIcon: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const CheckIcon: FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const ShieldIcon = () => (
  <svg
    className="shrink-0 text-tealText"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// A small icon-only copy button, for values that sit inside a row.
const CopyIconButton = ({ text, label }: { text: string; label: string }) => {
  const t = useT();
  const toaster = useToaster();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        copy(text);
        toaster.show(t('agent_copied', 'Copied to clipboard'), 'success');
      }}
      className="shrink-0 w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-textItemBlur hover:text-newTextColor hover:bg-boxHover transition-colors"
    >
      <CopyIcon />
    </button>
  );
};

// A UI path inside a sentence, e.g. Settings › Connectors.
const PathChip: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="px-[7px] py-[2px] mx-[2px] rounded-[6px] bg-btnSimple border border-newBorder text-[12px] font-[600] text-newTextColor whitespace-normal [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
    {children}
  </span>
);

const ShortStep: FC<{ index: number; children: ReactNode }> = ({
  index,
  children,
}) => (
  <li className="flex gap-[12px] items-start">
    <span className="shrink-0 w-[24px] h-[24px] rounded-full bg-tealSoft text-tealText text-[12px] font-[700] flex items-center justify-center">
      {index}
    </span>
    <div className="flex-1 min-w-0 flex flex-col gap-[8px] text-[14px] leading-[24px]">
      {children}
    </div>
  </li>
);

const SubLine: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="text-[12px] leading-[22px] text-textItemBlur -mt-[4px]">
    {children}
  </div>
);

// The fields to type into the chat app's "add connector" form.
const FieldsCard = ({
  rows,
}: {
  rows: { label: string; value: string; copyText?: string; hint?: boolean }[];
}) => {
  const t = useT();
  return (
    <div className="rounded-[10px] border border-newBorder bg-newBgColorInner divide-y divide-newBorder">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center gap-[12px] ps-[14px] pe-[6px] min-h-[44px] py-[4px]"
        >
          <span className="w-[96px] sm:w-[128px] shrink-0 text-[12px] text-textItemBlur">
            {row.label}
          </span>
          <span
            className={clsx(
              'flex-1 min-w-0 text-[13px] break-words',
              row.hint ? 'text-textItemBlur' : 'font-[600]'
            )}
          >
            {row.value}
          </span>
          {row.copyText ? (
            <CopyIconButton
              text={row.copyText}
              label={t('agent_copy_value', 'Copy')}
            />
          ) : (
            <span className="w-[32px] shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
};

const TRY_IT_PROMPT_DEFAULT =
  'List my Voholabs Studio channels, then schedule a post for tomorrow at 9am about our new feature.';

const TryItBox = () => {
  const t = useT();
  const prompt = t('agent_try_it_prompt', TRY_IT_PROMPT_DEFAULT);
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="text-[13px] font-[600]">
        {t('agent_try_it', 'Try it: ask your agent')}
      </div>
      <div className="flex items-center gap-[8px] rounded-[10px] border border-newBorder bg-tealHover ps-[14px] pe-[6px] py-[6px]">
        <span className="flex-1 min-w-0 text-[13px] leading-[1.6]">
          {prompt}
        </span>
        <CopyIconButton
          text={prompt}
          label={t('agent_copy_prompt', 'Copy prompt')}
        />
      </div>
    </div>
  );
};

// Collapsed by default: everything that is useful but not needed to connect.
const MoreHelp: FC<{ title: string; children: ReactNode }> = ({
  title,
  children,
}) => (
  <details className="group rounded-[10px] border border-newBorder bg-newBgColorInner">
    <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none flex items-center justify-between gap-[8px] px-[14px] min-h-[44px] text-[13px] font-[600] text-textItemBlur hover:text-newTextColor">
      {title}
      <svg
        className="shrink-0 transition-transform group-open:rotate-180"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </summary>
    <div className="px-[14px] pb-[14px] flex flex-col gap-[10px] text-[13px] leading-[1.7] text-textItemBlur">
      {children}
    </div>
  </details>
);

const HelpLink = ({ href, label }: { href: string; label: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="self-start font-[600] text-tealText hover:underline"
  >
    {label}
  </a>
);

// The one thing to do first: copy the link. Shown masked, with the short
// security line always visible.
const ConnectorLinkBlock = ({
  connectorUrl,
  apiKey,
  revealed,
  onToggleReveal,
}: {
  connectorUrl: string;
  apiKey: string;
  revealed: boolean;
  onToggleReveal: () => void;
}) => {
  const t = useT();
  const toaster = useToaster();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = () => {
    copy(connectorUrl);
    toaster.show(
      t('agent_link_copied_toast', 'Connector link copied to clipboard'),
      'success'
    );
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] border border-newBorder bg-newBgColorInner p-[16px]">
      <button
        type="button"
        onClick={onCopy}
        className="w-full sm:w-auto sm:self-start h-[48px] px-[24px] rounded-[10px] bg-btnPrimary hover:brightness-110 transition-all text-white text-[15px] font-[600] flex items-center justify-center gap-[10px]"
      >
        {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        {copied
          ? t('agent_link_copied', 'Link copied')
          : t('agent_copy_connector_link', 'Copy your connector link')}
      </button>
      <div className="flex items-center gap-[10px] min-w-0">
        <code
          dir="ltr"
          className={clsx(
            'flex-1 min-w-0 text-[12px] text-textItemBlur',
            revealed ? 'break-all' : 'truncate'
          )}
        >
          {revealed ? connectorUrl : maskKey(connectorUrl, apiKey)}
        </code>
        <button
          type="button"
          onClick={onToggleReveal}
          className="shrink-0 text-[12px] font-[600] text-tealText hover:underline"
        >
          {revealed ? t('hide', 'Hide') : t('reveal', 'Reveal')}
        </button>
      </div>
      <div className="flex items-center gap-[8px] text-[12px] text-textItemBlur">
        <ShieldIcon />
        {t(
          'agent_link_private',
          'This link is private: it can post to your channels.'
        )}
      </div>
    </div>
  );
};

const ConnectTabs = <T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) => (
  <div
    role="tablist"
    className="flex w-full sm:w-auto sm:self-start gap-[4px] p-[4px] rounded-[10px] bg-btnSimple overflow-x-auto"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="tab"
        aria-selected={value === option.value}
        onClick={() => onChange(option.value)}
        className={clsx(
          'flex-1 sm:flex-none min-w-0 px-[10px] sm:px-[16px] h-[36px] rounded-[8px] text-[13px] font-[600] transition-colors whitespace-nowrap',
          value === option.value
            ? 'bg-btnPrimary text-white'
            : 'text-textItemBlur hover:text-newTextColor'
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

// The API key, blurred except its last characters until revealed.
const ApiKeyField = ({
  apiKey,
  revealed,
}: {
  apiKey: string;
  revealed: boolean;
}) => (
  <div className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[44px] flex items-center overflow-hidden">
    <code dir="ltr" className="text-[14px] flex-1 truncate">
      {revealed ? (
        apiKey
      ) : (
        <span className="flex items-center">
          <span className="blur-sm select-none">{apiKey.slice(0, -5)}</span>
          <span>{apiKey.slice(-5)}</span>
        </span>
      )}
    </code>
  </div>
);

// Claude and ChatGPT add a connector in their own settings. The coding agents
// that most people use get a tab each; every other client sits under "Other
// agents". The API tab is only in onboarding: Settings has its own API key card.
type ConnectTarget =
  | 'claude'
  | 'chatgpt'
  | 'Claude Code'
  | 'Cursor'
  | 'Codex'
  | 'other'
  | 'api';

const featuredClients: readonly McpClient[] = [
  'Claude Code',
  'Cursor',
  'Codex',
];
const otherClients = mcpClients.filter(
  (client) => !featuredClients.includes(client)
);

// "Any other agent": no settings to fill in, a prompt to paste into the chat.
type OtherPick = McpClient | 'any';

const CONNECTOR_NAME = 'Voholabs Studio';

const CLI_INSTALL = 'npm install -g github:voholabs/voholabs-studio-cli';

const ConnectSection = ({
  apiKey,
  mcpBase,
  apiBase,
  cloudflareUrl,
  bare,
}: {
  apiKey: string;
  mcpBase: string;
  // The public API's base, what the CLI talks to.
  apiBase: string;
  cloudflareUrl: string;
  // Without the card and its heading, for the onboarding step that has its own.
  bare?: boolean;
}) => {
  const t = useT();
  const [target, setTarget] = useState<ConnectTarget>('claude');
  const [otherPick, setOtherPick] = useState<OtherPick>(otherClients[0]);
  const [auth, setAuth] = useState<McpAuth>('oauth');
  const [revealed, setRevealed] = useState(false);

  // A key revealed on one tab stays hidden on the next.
  const chooseTarget = (value: ConnectTarget) => {
    setTarget(value);
    setRevealed(false);
  };
  const chooseAuth = (value: McpAuth) => {
    setAuth(value);
    setRevealed(false);
  };

  // Chat apps cannot send an Authorization header, so the key travels in the URL.
  const connectorUrl = `${mcpBase}/mcp/${apiKey}`;
  const oauthUrl = getMcpOauthUrl(mcpBase);
  const client: OtherPick | null =
    target === 'other'
      ? otherPick
      : target === 'Claude Code' || target === 'Cursor' || target === 'Codex'
      ? target
      : null;
  const mcpClient = client && client !== 'any' ? client : null;
  const { config, hint } = mcpClient
    ? getMcpConfig(mcpClient, auth, mcpBase, apiKey)
    : { config: '', hint: '' };
  const installLink =
    mcpClient && auth === 'oauth'
      ? getMcpInstallLink(mcpClient, mcpBase)
      : null;

  // Agent sandboxes allowlist outbound hosts, so both directions fail until
  // the host is added (Claude's last step below). Uploading a
  // local file goes to us; reading a photo or video back comes from wherever
  // media is stored, which is a different host when that is object storage.
  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  const allowlistHosts = (() => {
    const app = hostOf(mcpBase);
    if (!cloudflareUrl) {
      // Local storage: media is served by the app itself, so one host covers it.
      return [app];
    }

    const media = hostOf(cloudflareUrl);
    // An R2 public bucket sits on a random subdomain and a new bucket gets a
    // new one, so allow the whole provider rather than a name that can change.
    const mediaEntry = media.endsWith('.r2.dev') ? '*.r2.dev' : media;

    return mediaEntry && mediaEntry !== app ? [app, mediaEntry] : [app];
  })();

  const docsHref =
    target === 'claude'
      ? 'https://voholabs.com/docs/agents/claude'
      : target === 'chatgpt'
      ? 'https://voholabs.com/docs/agents/chatgpt'
      : target === 'api'
      ? 'https://voholabs.com/docs/api'
      : client === 'any'
      ? 'https://voholabs.com/docs/agents/mcp'
      : 'https://voholabs.com/docs/agents/developer-tools';

  const securityDetail = t(
    'agent_link_security_full',
    'This link contains your API key. Anyone who has it can read and publish to your channels. Only paste it into your own Claude or ChatGPT settings, never into a shared chat or document. If it leaks, rotate your API key in Settings and add the connector again.'
  );

  // The paste-in prompt for an agent with no MCP settings screen: it connects
  // itself, or falls back to the Voholabs CLI. The key is never in the prompt;
  // the agent asks for it.
  const chatPrompt = t(
    'agent_chat_prompt',
    'Connect to Voholabs Studio, my social media scheduler, over MCP (streamable HTTP). Add the server {{oauthUrl}} and open its sign-in page for me. If you cannot sign in with OAuth, use {{mcpUrl}} with the header "Authorization: Bearer <API key>" and ask me for my Voholabs Studio API key. If you cannot add MCP servers but can run commands, install the Voholabs CLI with `{{cliInstall}}`, ask me for my API key, set it as VOHOLABS_API_KEY and set VOHOLABS_API_URL to {{apiUrl}}. Then list my Voholabs Studio channels.',
    {
      oauthUrl,
      mcpUrl: `${mcpBase}/mcp`,
      cliInstall: CLI_INSTALL,
      apiUrl: apiBase,
      interpolation: { escapeValue: false },
    }
  );

  const authTabs = (
    <div className="flex flex-col gap-[6px]">
      <ConnectTabs<McpAuth>
        value={auth}
        onChange={chooseAuth}
        options={[
          { value: 'oauth', label: t('agent_auth_sign_in', 'Sign in') },
          { value: 'apikey', label: t('agent_auth_api_key', 'With API key') },
        ]}
      />
      <SubLine>
        {auth === 'oauth'
          ? t(
              'agent_auth_sign_in_sub',
              'Recommended. You sign in to Studio and pick a workspace. No key to copy.'
            )
          : t(
              'agent_auth_api_key_sub',
              'Uses your API key. Rotating the key disconnects this agent.'
            )}
      </SubLine>
    </div>
  );

  const signInStep = (index: number, button: string) => (
    <ShortStep index={index}>
      <div>
        {t(
          'agent_step_sign_in',
          'Click {{button}}. Studio opens: sign in, pick your workspace and click Authorize.',
          { button, interpolation: { escapeValue: false } }
        )}
      </div>
    </ShortStep>
  );

  const linkBlock = (
    <ConnectorLinkBlock
      connectorUrl={connectorUrl}
      apiKey={apiKey}
      revealed={revealed}
      onToggleReveal={() => setRevealed(!revealed)}
    />
  );

  // The URL row of the "add connector" form: the sign-in address to copy, or
  // the link copied above.
  const urlRow = (label: string) =>
    auth === 'oauth'
      ? { label, value: oauthUrl, copyText: oauthUrl }
      : {
          label,
          value: t('agent_paste_link', 'Paste the link you copied'),
          hint: true,
        };

  const targetOptions: {
    value: ConnectTarget;
    label: string;
    icon: ReactNode;
  }[] = [
    {
      value: 'claude',
      label: t('agent_tab_claude', 'Claude'),
      icon: <McpClientIcon client="Claude" />,
    },
    {
      value: 'chatgpt',
      label: t('agent_tab_chatgpt', 'ChatGPT'),
      icon: <McpClientIcon client="ChatGPT" />,
    },
    ...featuredClients.map((item) => ({
      value: item as ConnectTarget,
      label: item,
      icon: <McpClientIcon client={item} />,
    })),
    {
      value: 'other',
      label: t('agent_tab_other', 'Other agents'),
      icon: <McpClientIcon client="Other agents" />,
    },
    ...(bare
      ? [
          {
            value: 'api' as ConnectTarget,
            label: t('agent_tab_api', 'API'),
            icon: <McpClientIcon client="API" />,
          },
        ]
      : []),
  ];

  const content = (
    <div className="flex flex-col gap-[20px] min-w-0">
      <AgentConnectionStatus />
      <Tabs<ConnectTarget>
        value={target}
        onChange={chooseTarget}
        options={targetOptions}
      />

      {target === 'claude' && (
        <>
          {authTabs}
          {auth === 'apikey' && linkBlock}
          <ol className="flex flex-col gap-[16px]">
            <ShortStep index={1}>
              <div>
                {t('agent_claude_step_open', 'Open')}{' '}
                <PathChip>
                  {t(
                    'agent_claude_path',
                    'Settings › Connectors › Add custom connector'
                  )}
                </PathChip>
              </div>
              <SubLine>
                {t('agent_claude_in_cowork', 'In Cowork:')}{' '}
                <PathChip>
                  {t('agent_claude_cowork_path', 'Customize › Connectors › +')}
                </PathChip>
              </SubLine>
            </ShortStep>
            <ShortStep index={2}>
              <div>
                {t(
                  'agent_claude_step_fill',
                  'Fill in these two fields, then click Add'
                )}
              </div>
              <FieldsCard
                rows={[
                  {
                    label: t('agent_field_name', 'Name'),
                    value: CONNECTOR_NAME,
                    copyText: CONNECTOR_NAME,
                  },
                  urlRow(t('agent_field_url', 'URL')),
                ]}
              />
            </ShortStep>
            {auth === 'oauth' && signInStep(3, 'Connect')}
            <ShortStep index={auth === 'oauth' ? 4 : 3}>
              <div>
                {t('agent_claude_step_turn_on', 'In a chat, switch it on:')}{' '}
                <PathChip>
                  {t(
                    'agent_claude_chat_path',
                    '+ › Connectors › Voholabs Studio'
                  )}
                </PathChip>
              </div>
            </ShortStep>
            <ShortStep index={auth === 'oauth' ? 5 : 4}>
              <div>
                {t(
                  'agent_claude_step_allowlist',
                  "Allow Studio's file domains:"
                )}{' '}
                <PathChip>
                  {t(
                    'agent_claude_allowlist_path',
                    'Settings › Capabilities › Domain allowlist'
                  )}
                </PathChip>
              </div>
              <div className="flex items-start gap-[8px]">
                <div className="flex-1 min-w-0">
                  <CodeBlock>{allowlistHosts.join('\n')}</CodeBlock>
                </div>
                <CopyIconButton
                  text={allowlistHosts.join('\n')}
                  label={
                    allowlistHosts.length > 1
                      ? t('copy_domains', 'Copy domains')
                      : t('copy_domain', 'Copy domain')
                  }
                />
              </div>
              <SubLine>
                {t(
                  'agent_claude_allowlist_why',
                  "Without this, Claude can't send or open your images and videos."
                )}
              </SubLine>
            </ShortStep>
          </ol>
          <TryItBox />
          <MoreHelp title={t('agent_more_help', 'More help')}>
            <div>
              {t(
                'claude_connector_intro',
                'Connectors live in your Claude account, so adding this once turns it on everywhere you use Claude — Cowork, the desktop app, claude.ai and mobile.'
              )}
            </div>
            {auth === 'oauth' ? (
              <div>
                {t(
                  'agent_claude_oauth_advanced',
                  'Leave "Advanced settings" (OAuth Client ID and Secret) empty: Claude registers itself with Studio when you click Connect. To use another workspace, add the connector again and pick it.'
                )}
              </div>
            ) : (
              <>
                <div>
                  {t(
                    'leave_advanced_settings_empty',
                    'Leave "Advanced settings" (OAuth Client ID and Secret) empty — the link already signs you in. Click Add, and Claude will connect straight away.'
                  )}
                </div>
                <div>{securityDetail}</div>
              </>
            )}
            <HelpLink
              href={docsHref}
              label={t('agent_studio_docs', 'Studio docs: step by step')}
            />
            <HelpLink
              href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
              label={t('agent_claude_docs', 'Claude help: custom connectors')}
            />
          </MoreHelp>
        </>
      )}

      {target === 'chatgpt' && (
        <>
          {authTabs}
          {auth === 'apikey' && linkBlock}
          <ol className="flex flex-col gap-[16px]">
            <ShortStep index={1}>
              <div>
                {t('agent_chatgpt_step_dev_mode', 'Turn on developer mode:')}{' '}
                <PathChip>
                  {t(
                    'agent_chatgpt_dev_mode_path',
                    'Settings › Security and login › Developer mode'
                  )}
                </PathChip>
              </div>
              <SubLine>
                {t(
                  'agent_chatgpt_web_only',
                  'On the web only, on Plus, Pro, Business, Enterprise or Edu.'
                )}
              </SubLine>
            </ShortStep>
            <ShortStep index={2}>
              <div>
                {t('agent_chatgpt_step_open', 'Open')}{' '}
                <PathChip>
                  {t(
                    'agent_chatgpt_create_path',
                    'Plugins › Add › Create custom MCP server'
                  )}
                </PathChip>
              </div>
            </ShortStep>
            <ShortStep index={3}>
              <div>
                {t(
                  'agent_chatgpt_step_fill_create',
                  'Fill in these fields, tick "I understand and want to continue" and click Create'
                )}
              </div>
              <FieldsCard
                rows={[
                  {
                    label: t('agent_field_name', 'Name'),
                    value: CONNECTOR_NAME,
                    copyText: CONNECTOR_NAME,
                  },
                  urlRow(t('agent_field_mcp_url', 'MCP Server URL')),
                  {
                    label: t('agent_field_auth', 'Authentication'),
                    value:
                      auth === 'oauth'
                        ? t('agent_auth_oauth_value', 'OAuth')
                        : t('no_authentication', 'No authentication'),
                  },
                ]}
              />
            </ShortStep>
            {auth === 'oauth' && signInStep(4, 'Continue')}
          </ol>
          <TryItBox />
          <MoreHelp title={t('agent_more_help', 'More help')}>
            <div>
              {t(
                'chatgpt_connector_intro',
                'ChatGPT needs developer mode to add a connector of your own. It is on Plus, Pro, Business, Enterprise and Edu, and only on the web — the phone apps cannot add one.'
              )}
            </div>
            <div>
              {t(
                'agent_chatgpt_admin_note',
                'On a work plan the Developer mode switch only appears once an admin has allowed it, so ask yours if it is missing.'
              )}
            </div>
            {auth === 'oauth' ? (
              <div>
                {t(
                  'agent_chatgpt_oauth_note',
                  'Leave the OAuth client ID and secret empty: ChatGPT registers itself with Studio. There is no per-chat switch and nothing to allowlist.'
                )}
              </div>
            ) : (
              <>
                <div>
                  {t(
                    'no_authentication_is_correct',
                    '"No authentication" is the right choice here, even though it sounds wrong: your link already carries the key that signs you in, and ChatGPT has no field to put one in separately. Treat the link like a password — anyone holding it can post as you.'
                  )}
                </div>
                <div>{securityDetail}</div>
              </>
            )}
            <HelpLink
              href={docsHref}
              label={t('agent_studio_docs', 'Studio docs: step by step')}
            />
            <HelpLink
              href="https://developers.openai.com/api/docs/guides/developer-mode"
              label={t('agent_chatgpt_docs', 'ChatGPT help: developer mode')}
            />
          </MoreHelp>
          {/*
            Creating the connector is the last thing anyone has to do: it is
            usable straight away, with no per-chat step and nothing to
            allowlist. Claude needs hosts permitted because it runs tools in a
            sandbox; ChatGPT reaches us from its own infrastructure, so there
            is no images section here.
          */}
        </>
      )}

      {!!client && (
        <>
          {target === 'other' && (
            <div className="flex flex-col gap-[8px] rounded-[10px] border border-newBorder bg-newBgColorInner p-[12px]">
              <div className="text-[12px] font-[600] text-textItemBlur">
                {t('agent_pick_your_agent', 'Pick your agent')}
              </div>
              <Tabs<OtherPick>
                value={otherPick}
                onChange={setOtherPick}
                options={[
                  ...otherClients.map((item) => ({
                    value: item as OtherPick,
                    label: item,
                    icon: <McpClientIcon client={item} />,
                  })),
                  {
                    value: 'any' as OtherPick,
                    label: t('agent_any_other', 'Any other agent'),
                  },
                ]}
              />
            </div>
          )}
          {client === 'any' ? (
            <div className="flex flex-col gap-[8px]">
              <div className="text-[13px] text-textItemBlur leading-[1.7]">
                {t(
                  'agent_chat_prompt_intro',
                  'No settings screen? Paste this into your agent. It connects itself and asks you to sign in, or for your API key.'
                )}
              </div>
              <CodeBlock>{chatPrompt}</CodeBlock>
              <div className="flex gap-[8px] flex-wrap">
                <CopyButton
                  text={chatPrompt}
                  label={t('copy', 'Copy')}
                  primary={true}
                />
              </div>
            </div>
          ) : (
            <>
              {authTabs}
              {!!installLink && (
                <a
                  href={installLink}
                  className="w-full sm:w-auto sm:self-start h-[48px] px-[24px] rounded-[10px] bg-btnPrimary hover:brightness-110 transition-all text-white text-[15px] font-[600] flex items-center justify-center gap-[10px]"
                >
                  <McpClientIcon client={client} size={18} />
                  {t('agent_add_to_client', 'Add to {{client}}', {
                    client,
                    interpolation: { escapeValue: false },
                  })}
                </a>
              )}
              <div className="flex flex-col gap-[8px]">
                <div className="text-[12px] text-textItemBlur font-[500]">
                  {!!installLink &&
                    `${t('agent_or_add_by_hand', 'Or add it by hand.')} `}
                  {hint}
                  {auth === 'oauth' &&
                    ` ${t(
                      'agent_oauth_browser_hint',
                      'Your agent opens a browser window to sign in to Studio.'
                    )}`}
                </div>
                <CodeBlock>
                  {revealed ? config : maskKey(config, apiKey)}
                </CodeBlock>
                <div className="flex gap-[8px] flex-wrap">
                  <CopyButton
                    text={config}
                    label={t('copy', 'Copy')}
                    primary={!installLink}
                  />
                  {auth === 'apikey' && (
                    <RevealButton
                      revealed={revealed}
                      onClick={() => setRevealed(!revealed)}
                    />
                  )}
                  <CopyButton
                    text={auth === 'oauth' ? oauthUrl : `${mcpBase}/mcp`}
                    label={t('copy_url', 'Copy URL')}
                  />
                </div>
              </div>
              <TryItBox />
              <MoreHelp
                title={t(
                  'agent_prefer_cli',
                  'Prefer a CLI? Use the Voholabs CLI'
                )}
              >
                <div>
                  {t(
                    'agent_cli_intro',
                    'Agents that run in a terminal can use the Voholabs CLI instead of MCP. Install it and sign in with your browser:'
                  )}
                </div>
                <CodeBlock>{`${CLI_INSTALL}\nvoholabs auth:login`}</CodeBlock>
                <div className="flex gap-[8px] flex-wrap">
                  <CopyButton
                    text={`${CLI_INSTALL} && voholabs auth:login`}
                    label={t('copy_all', 'Copy All')}
                  />
                </div>
                <HelpLink
                  href="https://voholabs.com/docs/cli"
                  label={t('agent_cli_docs', 'CLI documentation')}
                />
              </MoreHelp>
            </>
          )}
          <HelpLink
            href={docsHref}
            label={t('agent_mcp_docs', 'MCP documentation')}
          />
        </>
      )}

      {target === 'api' && (
        <>
          <div className="text-[13px] text-textItemBlur leading-[1.7]">
            {t(
              'agent_api_intro',
              'Use the Voholabs Studio API from your own code, n8n or any other automation. Send your API key as the Authorization header on every request.'
            )}
          </div>
          <ApiKeyField apiKey={apiKey} revealed={revealed} />
          <div className="flex gap-[8px] flex-wrap">
            <CopyButton
              text={apiKey}
              label={t('api_key', 'API Key')}
              primary={true}
            />
            <RevealButton
              revealed={revealed}
              onClick={() => setRevealed(!revealed)}
            />
          </div>
          <div className="flex gap-[16px] flex-wrap">
            <HelpLink
              href={docsHref}
              label={t('agent_api_docs', 'API documentation')}
            />
            <HelpLink
              href={`${apiBase}/public/v1/openapi.json`}
              label={t('agent_openapi', 'OpenAPI spec')}
            />
          </div>
        </>
      )}
    </div>
  );

  if (bare) {
    return content;
  }

  return (
    <SectionCard
      title={t('connect_an_ai_agent', 'Connect an AI agent')}
      description={t(
        'connect_an_ai_agent_description',
        'Let Claude, ChatGPT or your coding agent write and schedule posts for you. No installation needed.'
      )}
      actions={<DocsLink href={docsHref} label={t('read_the_docs', 'Docs')} />}
    >
      {content}
    </SectionCard>
  );
};

const localCliSteps = [
  {
    label: 'Install the CLI',
    code: CLI_INSTALL,
  },
  {
    label: 'Run: voholabs auth:login',
    code: 'voholabs auth:login',
  },
  {
    label: 'Install the Voholabs skill for your AI agent',
    code: 'npx skills add voholabs/voholabs-studio-cli',
  },
] as const;

const ciCliSteps = [
  {
    label: 'Install the CLI',
    code: CLI_INSTALL,
  },
  {
    label: 'Set your API key as an environment variable',
    code: 'export VOHOLABS_API_KEY="{API_KEY}"',
  },
  {
    label: 'Install the Voholabs skill for your AI agent',
    code: 'npx skills add voholabs/voholabs-studio-cli',
  },
] as const;

const CliSection = ({ apiKey }: { apiKey: string }) => {
  const t = useT();
  const [mode, setMode] = useState<'local' | 'ci'>('local');
  const [revealed, setRevealed] = useState(false);

  const steps =
    mode === 'local'
      ? localCliSteps.map((step) => ({ ...step }))
      : ciCliSteps.map((step) => ({
          ...step,
          code: step.code.replace('{API_KEY}', apiKey),
        }));

  const displaySteps =
    mode === 'ci' && !revealed
      ? steps.map((step) => ({ ...step, code: maskKey(step.code, apiKey) }))
      : steps;

  return (
    <SectionCard
      title={t('cli_and_skills', 'CLI & AI Skills')}
      description={t(
        'cli_description',
        'Use the Voholabs CLI to automate posting from your terminal, or install the skill to let your AI agent schedule posts for you.'
      )}
      actions={
        <DocsLink
          href="https://voholabs.com/docs/cli"
          label={t('read_the_docs', 'Docs')}
        />
      }
    >
      <Tabs<'local' | 'ci'>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'local', label: t('locally', 'Locally') },
          { value: 'ci', label: t('ci_remote_servers', 'CI / Remote servers') },
        ]}
      />
      {displaySteps.map((step, i) => (
        <div key={i} className="flex flex-col gap-[6px]">
          <div className="text-[13px] font-[600] text-customColor18">
            {i + 1}. {step.label}
          </div>
          <CodeBlock>{step.code}</CodeBlock>
        </div>
      ))}
      <div className="flex flex-wrap gap-[8px]">
        {mode === 'ci' && (
          <RevealButton
            revealed={revealed}
            onClick={() => setRevealed(!revealed)}
          />
        )}
        <CopyButton
          text={steps.map((s) => s.code).join(' && ')}
          label={t('copy_all', 'Copy All')}
        />
      </div>
    </SectionCard>
  );
};

const PublicApiContent = () => {
  const user = useUser();
  const { backendUrl, frontEndUrl, mcpUrl, cloudflareUrl } = useVariables();
  const toaster = useToaster();
  const fetch = useFetch();
  const decision = useDecisionModal();
  const { mutate } = useSWRConfig();
  const [reveal, setReveal] = useState(false);
  const t = useT();

  const rotateKey = useCallback(async () => {
    const approved = await decision.open({
      title: t('rotate_api_key', 'Rotate API Key?'),
      description: t(
        'rotate_api_key_description',
        'This will generate a new API key and invalidate the current one. Any integrations using the old key will stop working — including agents you connected with a connector link.'
      ),
      approveLabel: t('rotate', 'Rotate'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    await fetch('/user/api-key/rotate', { method: 'POST' });
    await mutate('/user/self');
    setReveal(false);
    toaster.show(
      t('api_key_rotated', 'API Key rotated successfully'),
      'success'
    );
  }, [decision, fetch, mutate, toaster]);

  if (!user || !user.publicApi) {
    return null;
  }

  const mcpBase = mcpUrl || backendUrl;

  return (
    <div className="flex flex-col gap-[40px]">
      <ConnectSection
        apiKey={user.publicApi}
        mcpBase={mcpBase}
        apiBase={backendUrl}
        cloudflareUrl={cloudflareUrl}
      />

      <SectionCard
        title={t('api_key', 'API Key')}
        description={t(
          'use_postiz_api_to_integrate_with_your_tools',
          'The same key powers your connectors, the CLI and the API. Keep it private.'
        )}
        actions={
          <>
            <DocsLink
              href="https://voholabs.com/docs/api"
              label={t('read_the_docs', 'Docs')}
            />
            <DocsLink
              href="https://www.npmjs.com/package/n8n-nodes-postiz"
              label={t('n8n_node', 'N8N Node')}
            />
          </>
        }
      >
        <ApiKeyField apiKey={user.publicApi} revealed={reveal} />
        <div className="flex gap-[8px] flex-wrap">
          <RevealButton revealed={reveal} onClick={() => setReveal(!reveal)} />
          <CopyButton text={user.publicApi} label={t('copy', 'Copy')} />
          <button
            type="button"
            onClick={rotateKey}
            className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6" />
              <path d="M21.34 15.57a10 10 0 11-.57-8.38L21.5 8" />
            </svg>
            {t('rotate_key', 'Rotate Key')}
          </button>
          <button
            type="button"
            data-tooltip-id="tooltip"
            data-tooltip-content={t(
              'payload_wizard_description',
              'Building a POST request to /posts can be complex. Use the wizard to schedule a post with the UI, then copy the generated payload.'
            )}
            onClick={() =>
              window.open(`${frontEndUrl}/modal/dark/all`, '_blank')
            }
            className="cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {t('open_wizard', 'Open Wizard')}
          </button>
        </div>
      </SectionCard>

      <CliSection apiKey={user.publicApi} />

      <div className="text-[13px] text-customColor18 leading-[1.7]">
        {t(
          'api_auth_note_line2',
          'Building a product that schedules posts on behalf of other Voholabs users? Create an OAuth App under Settings › Apps — your users authorize it with OAuth2 and you receive a pos_ prefixed token that works with the API, MCP and CLI, just like an API Key.'
        )}
      </div>
    </div>
  );
};

// The "Connect an AI agent" panel on its own, for the onboarding step.
// Nothing shows without an API key. `bare` drops the card and its heading.
export const ConnectAgentPanel: FC<{ bare?: boolean }> = ({ bare }) => {
  const user = useUser();
  const { backendUrl, mcpUrl, cloudflareUrl } = useVariables();
  if (!user?.publicApi) {
    return null;
  }
  return (
    <ConnectSection
      apiKey={user.publicApi}
      mcpBase={mcpUrl || backendUrl}
      apiBase={backendUrl}
      cloudflareUrl={cloudflareUrl}
      bare={bare}
    />
  );
};

// A paid plan keeps the panel it always had; every other plan gets the new
// connect-agent panel, the same one onboarding shows.
export const PublicComponent = () =>
  useWalletAccess() === 'plan' ? (
    <LegacyPublicComponent />
  ) : (
    <WalletPublicComponent />
  );

// OAuth apps are managed under Settings > Apps, so this tab is the connect
// panel, the API key and the CLI.
const WalletPublicComponent = () => {
  return (
    <div className="flex flex-col gap-[20px]">
      <PublicApiContent />
    </div>
  );
};
