// @ts-ignore
import twitter from 'twitter-text';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import {
  PricedAction,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

// Shared by the wallet tools and the schedule tool's cost line. Every number
// comes from the database; every sentence is generated from a row's fields,
// so a new price row needs no new copy here.

export const notOnWalletMessage = 'Your plan does not use wallet credits.';

export const topUpUrl = () => `${process.env.FRONTEND_URL}/wallet`;

export const shortWarning = () =>
  `Not enough credits yet. If you don't top up before it's due, this post won't go out. Top up: ${topUpUrl()}`;

// Hundredths of a credit -> credits, 2 decimals.
export const toCredits = (units: number) => Math.round(units) / 100;

export const creditsText = (units: number) =>
  `${(units / 100).toFixed(2)} credits`;

export const orgFromContext = (context: any) => {
  try {
    return JSON.parse(
      (context?.requestContext as any)?.get('organization') as string
    );
  } catch (err) {
    return undefined;
  }
};

// Paid plans never touch the wallet.
export const onPaidPlan = (org: any) => hasAccess(org);

export interface WalletForecast {
  windowHours: number;
  needed: number;
  short: boolean;
}

// The scheduled paid usage due soon (WalletService.forecast). Missing or
// failing, it is simply left out: the forecast only ever adds a warning.
export const walletForecast = async (
  wallet: WalletService,
  organizationId: string
): Promise<WalletForecast | undefined> => {
  const forecast = (wallet as any).forecast;
  if (typeof forecast !== 'function') {
    return undefined;
  }
  try {
    const result = await forecast.call(wallet, organizationId);
    if (!result || typeof result.needed !== 'number') {
      return undefined;
    }
    return {
      windowHours: Number(result.windowHours) || 48,
      needed: result.needed,
      short: !!result.short,
    };
  } catch (err) {
    return undefined;
  }
};

// Whether a post's text carries a link once it is sent: a URL, or a
// "(post:<id>)" reference, which becomes a URL at publish.
export const postHasLink = (html: string) =>
  /\(post:[^)\s]+\)/.test(html || '') ||
  twitter.extractUrls(stripHtmlValidation('normal', html || '', true))
    .length > 0;

// Units of credit for one post and its replies on a channel the wallet
// charges per post. undefined when a row is missing (nothing is guessed).
export const postCost = async (
  wallet: WalletService,
  identifier: string,
  contents: string[]
) => {
  const provider = (identifier || '').toLowerCase().split('-')[0];
  let total = 0;
  for (const content of contents) {
    const priced = await wallet.price(
      `${provider}.${postHasLink(content) ? 'post_link' : 'post'}`
    );
    if (!priced) {
      return undefined;
    }
    total += priced.price;
  }
  return total;
};

const UNIT_LABELS: Record<string, [string, string]> = {
  gb: ['GB', 'GB'],
  '1k_tokens': ['1K tokens', '1K tokens'],
};

const SECTION_LABELS: Record<string, string> = {
  channels: 'Channels',
  storage: 'Storage',
  brief: 'Brief',
  skills: 'Skills',
};

const titleCase = (key: string) =>
  key.replace(/[_.-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const sectionLabel = (key: string) =>
  SECTION_LABELS[key] || titleCase(key);

const unitLabel = (unit: string, n = 1) => {
  const known = UNIT_LABELS[unit];
  const one = known ? known[0] : unit.replace(/_/g, ' ');
  const many = known ? known[1] : `${one}s`;
  return n === 1 ? one : many;
};

export const pricingModel = (a: PricedAction) =>
  a.billing === 'UNLOCK'
    ? 'Free'
    : a.billing === 'MONTHLY'
    ? `per ${unitLabel(a.unit)} / month`
    : `per ${unitLabel(a.unit)}`;

export const freeAllowance = (a: PricedAction) => {
  const afterTopUp = a.requiresTopUp ? ', unlocks after first top up' : '';
  if (a.billing === 'UNLOCK') {
    return `Unlimited use${afterTopUp}`;
  }
  const n = a.freeUnits || 0;
  if (!n) {
    return 'None';
  }
  if (a.freePeriod === 'ONCE') {
    return `${n === 1 ? 'First time free' : `First ${n} times free`}${afterTopUp}`;
  }
  if (a.freePeriod === 'MONTH') {
    return `${n} ${unitLabel(a.unit, n)} free each month`;
  }
  return `${n} ${unitLabel(a.unit, n)} included free`;
};

export const priceText = (a: PricedAction) =>
  a.billing === 'UNLOCK' ? 'Free' : creditsText(a.price);

// How a MONTHLY row is charged, from one template.
export const monthlyRules = (a: PricedAction) => {
  const n = a.freeUnits || 0;
  const one = unitLabel(a.unit);
  const many = unitLabel(a.unit, 2);
  return [
    n
      ? `Charged per ${one} above ${n} ${unitLabel(a.unit, n)} free, each month you're above it.`
      : `Charged per ${one}, each month you use it.`,
    `Charged the moment usage goes above ${
      n ? `the ${n} ${unitLabel(a.unit, n)} included free` : 'zero'
    }, for that ${one} until the end of the month.`,
    'Charged again at the start of each month while usage is still above it.',
    `Usage is rounded up to whole ${many}.`,
    'If your wallet has no credit, the balance can go negative.',
  ].join(' ');
};
