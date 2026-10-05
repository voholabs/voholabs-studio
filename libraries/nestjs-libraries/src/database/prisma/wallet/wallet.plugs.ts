import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// Handed to a provider's plug when the workspace pays for the provider's API
// from its wallet. Each paid call the plug makes goes through it: the call is
// charged first and only made when the charge went through, and the charge
// is given back when the network refuses the call. A plug run for any other
// workspace gets no meter and calls the network directly, as before.
export interface PlugMeter {
  // Reads one post (e.g. its like count), as `<provider>.post_read`. Charged
  // at most once per post per UTC day.
  read<T>(postId: string, call: () => Promise<T>): Promise<T>;
  // Sends a post, priced on the exact text sent (post or post_link).
  post<T>(text: string, call: () => Promise<T>): Promise<T>;
  // Reposts a post, as `<provider>.repost`.
  repost<T>(call: () => Promise<T>): Promise<T>;
}

// The meter refused a call, which was then not made.
// credits: the wallet could not pay (auto top-up included).
// unpriced: the action has no price row, so it is never made unbilled.
export class PlugNotRunError extends Error {
  constructor(public reason: 'credits' | 'unpriced', public actionKey: string) {
    super(
      reason === 'credits'
        ? `Not enough credits for ${actionKey}`
        : `No price for ${actionKey}`
    );
    this.name = 'PlugNotRunError';
  }
}

const providerOf = (identifier: string) =>
  (identifier || '').toLowerCase().split('-')[0];

const providerLabel = (identifier: string) => {
  const p = providerOf(identifier);
  return p.length <= 2 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
};

// The price rows a plug needs for its declared actions ('post' needs the
// plain post row; its link price is optional, see WalletService.postActionKey).
export const plugActionKeys = (identifier: string, actions: string[] = []) =>
  [...new Set(actions)].map((a) => `${providerOf(identifier)}.${a}`);

// One plug's paid call in one run: retries of the same run reuse the key, so
// Temporal retrying the activity never charges twice.
export const plugChargeKey = (
  identifier: string,
  plug: string,
  postId: string,
  run: number | string,
  action: string
) => `${providerOf(identifier)}plug:${plug}:${postId}:${run}:${action}`;

// A plug's read of one post, once per post per UTC day whichever plug or run
// reads it.
export const plugReadChargeKey = (
  identifier: string,
  orgId: string,
  postId: string,
  day = dayjs.utc().format('YYYY-MM-DD')
) => `${providerOf(identifier)}plugread:${orgId}:${day}:${postId}`;

// The in-app notice for one plug is sent at most once per UTC day.
export const plugNoticeKey = (
  plug: string,
  day = dayjs.utc().format('YYYY-MM-DD')
) => `plug-not-run:${plug}:${day}`;

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// A short, plain-text start of a post for a notification.
export const postExcerpt = (content?: string | null, max = 60) => {
  const text = (content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export const plugNotRunSubject = (identifier: string) =>
  `${providerLabel(identifier)} plug didn't run`;

// The notification text (stored as HTML; the link is turned into an anchor
// by the bell). The excerpt is escaped.
export const plugNotRunMessage = (
  identifier: string,
  reason: PlugNotRunError['reason'],
  excerpt: string,
  walletUrl: string
) => {
  const on = excerpt ? ` on '${escapeHtml(excerpt)}'` : '';
  const plug = `Your ${providerLabel(identifier)} plug${on}`;
  return reason === 'credits'
    ? `${plug} didn't run: not enough credits. Top up to keep plugs running: ${walletUrl}`
    : `${plug} didn't run: it isn't available with wallet credits yet.`;
};

// Shown when a plug is set up or switched on and one of its actions has no
// price row.
export const plugUnavailableMessage = () =>
  "This plug isn't available with wallet credits yet.";
