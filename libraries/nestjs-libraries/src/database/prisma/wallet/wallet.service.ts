import { HttpException, Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import {
  BillableAction,
  Wallet,
  WalletEntry,
  WalletEntryType,
} from '@prisma/client';
import {
  FreeAllowance,
  InsufficientCreditsError,
  WalletRepository,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.repository';
import {
  POST_REFERENCE_REGEX,
  referenceUrlPlaceholder,
  textHasLink,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.x';
import {
  hasAccess,
  paidOnlyChannelMessage,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { stripLinks } from '@gitroom/helpers/utils/strip.links';
import dayjs from 'dayjs';

export { InsufficientCreditsError };

// Amounts are integers in hundredths of a credit ("units"), so 180 is 1.80
// credits. Every number that decides a price lives in BillingSetting and
// BillableAction; these are only the names of the settings.
export const BILLING = {
  // The wallet's currency (ISO code, e.g. USD): what top-ups are paid in.
  currency: 'wallet_currency',
  // Credits for one unit of that currency (e.g. 100 for $1).
  creditsPerUnit: 'credits_per_unit',
  defaultMultiplierBp: 'default_multiplier_bp',
  // Exchange rate from a provider's currency into the wallet's, e.g.
  // fx.EUR = "1.08". Not needed for the wallet's own currency.
  fxPrefix: 'fx.',
  minTopUp: 'min_topup',
  topUpOptions: 'topup_options',
  // Auto top-up form defaults: the threshold (hundredths of a credit), the
  // amounts and monthly limits offered (smallest currency unit), each a
  // comma-separated list.
  autoTopUpThreshold: 'auto_topup_threshold',
  autoTopUpOptions: 'auto_topup_options',
  autoTopUpCapOptions: 'auto_topup_cap_options',
  // Whole welcome credits a workspace can claim once, in onboarding.
  // Optional: without it none are offered. Never a top-up, so it opens no
  // paid channel.
  signupCredits: 'signup_credits',
} as const;

// The Plus subscription's numbers, all in BillingSetting. Without the prices,
// the credits or the period, Plus is not offered. Prices are in the smallest
// unit of the wallet currency (BILLING.currency), credits are whole credits.
export const PLUS = {
  monthlyPrice: 'plus_monthly_price',
  annualPrice: 'plus_annual_price',
  // Whole credits granted each plan period.
  credits: 'plus_monthly_credits',
  // Days in a plan period: credits are released at its start and what is
  // left of them is gone at its end.
  periodDays: 'plus_period_days',
  // The early bird: percent off the first payment, valid for `minutes` from
  // the welcome credits claim, then once more for `extensionHours`.
  earlyBirdPercent: 'plus_early_bird_percent',
  earlyBirdMinutes: 'plus_early_bird_minutes',
  earlyBirdExtensionHours: 'plus_early_bird_extension_hours',
  // "on" sends the one email saying the early bird was extended.
  earlyBirdEmail: 'plus_early_bird_email',
  // When Plus launched (an ISO date-time). A workspace whose first top-up
  // came before it stays on pay-as-you-go (WalletService.access). Unset,
  // every workspace that ever topped up counts as from before Plus.
  launchAt: 'plus_launch_at',
} as const;

// Stripe subscription statuses that keep Plus on (until the paid span ends).
// past_due and unpaid are a renewal that has not been paid, so they do not.
export const PLUS_ACTIVE_STATUSES = ['active', 'trialing'];

// Statuses of a subscription whose payment failed and that Stripe is still
// trying to collect: Plus is off, and fixing the card brings it back.
export const PLUS_UNPAID_STATUSES = ['past_due', 'unpaid', 'incomplete'];

// A subscription that has not ended: a second one is never bought on top.
export const PLUS_OPEN_STATUSES = [
  ...PLUS_ACTIVE_STATUSES,
  ...PLUS_UNPAID_STATUSES,
];

// Whether the payment of the Plus subscription on record failed (Stripe is
// still collecting it).
export const plusPaymentFailed = (
  wallet: Pick<Wallet, 'plusSubscriptionId' | 'plusStatus'> | null | undefined
) =>
  !!wallet?.plusSubscriptionId &&
  PLUS_UNPAID_STATUSES.includes(wallet.plusStatus || '');

// Whether the paid span the subscription is in now has its invoice paid.
// Its plan credits are released only then.
export const plusSpanPaid = (
  wallet: Pick<Wallet, 'plusPeriodStart' | 'plusPaidPeriodStart'>
) =>
  !!wallet.plusPeriodStart &&
  wallet.plusPaidPeriodStart?.getTime() === wallet.plusPeriodStart.getTime();

const DAY_MS = 86_400_000;

// Whether a wallet has Plus now: a subscription in good standing, inside the
// span it paid for, and not on hold after a refund or dispute.
export const plusIsActive = (
  wallet:
    | Pick<
        Wallet,
        'plusSubscriptionId' | 'plusStatus' | 'plusPeriodEnd' | 'frozenAt'
      >
    | null
    | undefined,
  now = new Date()
) =>
  !!wallet?.plusSubscriptionId &&
  !wallet.frozenAt &&
  PLUS_ACTIVE_STATUSES.includes(wallet.plusStatus || '') &&
  !!wallet.plusPeriodEnd &&
  wallet.plusPeriodEnd.getTime() > now.getTime();

export interface PlanPeriod {
  index: number;
  start: Date;
  end: Date;
}

// The plan periods of one paid span (a month, or a year paid upfront): as
// many whole periods of `periodDays` as fit, at least one, the last one
// running to the end of the span. A month is one period; a year of 30-day
// periods is twelve.
export const planPeriods = (
  start: Date,
  end: Date,
  periodDays: number
): PlanPeriod[] => {
  const length = periodDays * DAY_MS;
  const span = end.getTime() - start.getTime();
  if (!(length > 0) || span <= 0) {
    return [];
  }
  const count = Math.max(1, Math.floor(span / length));
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: new Date(start.getTime() + index * length),
    end:
      index === count - 1
        ? new Date(end.getTime())
        : new Date(start.getTime() + (index + 1) * length),
  }));
};

// The ledger key of one plan period's credits: at most one grant each.
export const planGrantKey = (
  organizationId: string,
  subscriptionId: string,
  spanStart: Date,
  index: number
) => `plus:${organizationId}:${subscriptionId}:${spanStart.toISOString()}:${index}`;

export const planExpireKey = (grantKey: string) => `plus-expire:${grantKey}`;

// The period a plan grant covers, from its meta.
export const planGrantPeriod = (entry: Pick<WalletEntry, 'meta'>) => {
  try {
    const meta = JSON.parse(entry.meta || '{}');
    const start = new Date(meta.start);
    const end = new Date(meta.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return undefined;
    }
    return {
      subscriptionId: String(meta.subscriptionId || ''),
      start,
      end,
    };
  } catch {
    return undefined;
  }
};

const SETTINGS_TTL_MS = 30_000;
const FORECAST_HOURS = 48;

export interface ForecastItem {
  actionKey: string;
  quantity: number;
  at: Date;
  postId?: string;
}

export interface Forecast {
  windowHours: number;
  needed: number;
  short: boolean;
  items: ForecastItem[];
}

export interface PricedAction {
  key: string;
  provider: string;
  category: string | null;
  name: string;
  description: string | null;
  unit: string;
  freeUnits: number | null;
  freePeriod: string | null;
  billing: string;
  requiresTopUp: boolean;
  price: number;
}

export const formatCredits = (units: number) =>
  (units / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// "0.80" -> 800000 (millionths), without going through floating point.
const toMicros = (value: string) => {
  const [whole, fraction = ''] = value.trim().split('.');
  return (
    Number(whole || 0) * 1_000_000 + Number((fraction + '000000').slice(0, 6))
  );
};

const providerOf = (identifier: string) =>
  (identifier || '').toLowerCase().split('-')[0];

const providerLabel = (identifier: string) => {
  const p = providerOf(identifier);
  return p.length <= 2 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
};

// Shown when a channel is charged from the wallet and the workspace has no
// Plus. Welcome and granted credits do not open it: Plus does.
export const walletRequiredMessage = (identifier: string) =>
  `Not scheduled: posting to ${providerLabel(
    identifier
  )} is included with Plus and paid per post from wallet credits (the free credits don't cover it). Get Plus, then schedule it again.`;

// A request refused because it needs the wallet. The app opens the top-up
// for `wallet: true` instead of Postiz billing.
export const walletPaymentRequired = (message: string) =>
  new HttpException({ message, wallet: true, url: '/wallet' }, 402);

// A request refused because it needs Plus. The app opens the Plus page for
// `plus: true`.
export const plusRequired = (message: string) =>
  new HttpException({ message, wallet: true, plus: true, url: '/plus' }, 402);

// Shown when work charged by usage needs Plus.
export const usageTopUpRequiredMessage = (name: string) =>
  `${name} is included with Plus and paid from wallet credits (the free credits don't cover it). Get Plus, then try again.`;

// Shown when a top-up is asked for without Plus.
export const topUpNeedsPlusMessage = () =>
  'Top-ups are part of Plus. Get Plus to add credits to your wallet.';

// A top-up refused because the workspace has no Plus.
export class PlusRequiredError extends Error {
  constructor(message = topUpNeedsPlusMessage()) {
    super(message);
  }
}

// Auto top-up never charges a card while the Plus payment is failing.
export const autoTopUpPausedMessage = () =>
  'Automatic top-up is paused while your Plus payment is failing. Update your card to keep Plus, and it starts again.';

export const walletFrozenMessage = () =>
  'Your wallet is on hold after a refund or dispute of a payment. Contact support to sort it out.';

// The post is not published and is never retried; the user can top up and
// reschedule it.
export const notEnoughCreditsMessage = () =>
  "Not published: there weren't enough credits in your wallet when it was due. Top up, then reschedule it if you still want it out.";

// An amount paid, in the smallest unit of its currency, for messages.
const formatPaid = (amount: number, currency: string) => {
  try {
    const format = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.toUpperCase(),
    });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(amount / 10 ** digits);
  } catch {
    return `${amount} ${currency}`;
  }
};

const ceilDiv = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b;

const numberList = (value?: string) =>
  (value || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '' && !isNaN(Number(v)))
    .map(Number);

const startOfUtcMonth = (at = new Date()) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

// The receipt link stored on a top-up entry's meta, if any.
export const receiptUrlOf = (entry: Pick<WalletEntry, 'meta'>) => {
  if (!entry.meta) {
    return null;
  }
  try {
    const meta = JSON.parse(entry.meta);
    return typeof meta?.receiptUrl === 'string' ? meta.receiptUrl : null;
  } catch {
    return null;
  }
};

export interface EstimateItem {
  actionKey: string;
  price: number;
}

export interface Estimate {
  items: EstimateItem[];
  // The full price (per occurrence for a repeating post).
  price: number;
  // Credit already standing for the post being edited.
  alreadyPaid: number;
  // What scheduling takes now: price - alreadyPaid (negative gives back).
  due: number;
  balanceAfter: number;
  short: boolean;
  // Auto top-up can cover what the balance can't.
  autoCovers: boolean;
  // What auto top-up would charge the card for that, in the smallest unit
  // of the wallet currency; null when it isn't needed or can't cover it.
  autoAmount: number | null;
  // A repeating post: price is per occurrence, each charged as it goes out.
  perOccurrence?: boolean;
  repeatEveryDays?: number | null;
}

// The chargeKey of a post's charge. A repeating post's later occurrences add
// their run (see postOccurrenceChargeKey).
export const postChargeKey = (postId: string) => `post:${postId}`;

// The chargeKey of one occurrence of a post: its base key for the first (the
// one charged when it was scheduled), and a key per run for each repeat, so
// every occurrence is charged once however often Temporal retries it.
export const postOccurrenceChargeKey = (postId: string, run?: string) =>
  run ? `${postChargeKey(postId)}@${run}` : postChargeKey(postId);

// Which run of a post a publishing workflow is. The first run (workflow
// `post_<id>`) is the one paid for when it was scheduled; each repeat of a
// "Repeat post every..." post runs as `post_<id>_<suffix>` and is paid as its
// own occurrence. Temporal retries keep the workflow id, so a run is charged
// once however often it is retried.
export const repeatRunOf = (workflowId?: string) => {
  const match = /^post_[^_]+_([A-Za-z0-9]+)$/.exec(workflowId || '');
  return match ? match[1] : undefined;
};

// The chargeKey of one use of a usage-priced action (an AI image, a
// voice-over), from the caller's idempotency key, so a retried charge for the
// same use is charged once.
export const usageChargeKey = (
  organizationId: string,
  actionKey: string,
  idempotencyKey: string
) => `usage:${organizationId}:${actionKey}:${idempotencyKey}`;

// Whether a post row already went out (its charge was used up).
export const postWasSent = (post: {
  releaseURL?: string | null;
  releaseId?: string | null;
}) => !!post.releaseURL || !!post.releaseId;

@Injectable()
export class WalletService {
  private _settings?: { at: number; values: Record<string, string> };
  private _actions?: { at: number; values: BillableAction[] };

  private _logger = new Logger(WalletService.name);

  constructor(
    private _wallet: WalletRepository,
    private _notifications: NotificationService
  ) {}

  async settings() {
    if (!this._settings || Date.now() - this._settings.at > SETTINGS_TTL_MS) {
      const rows = await this._wallet.settings();
      this._settings = {
        at: Date.now(),
        values: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      };
    }
    return this._settings.values;
  }

  // The active price rows, cached like the settings.
  async actions() {
    if (!this._actions || Date.now() - this._actions.at > SETTINGS_TTL_MS) {
      this._actions = { at: Date.now(), values: await this._wallet.actions() };
    }
    return this._actions.values;
  }

  private async numberSetting(key: string) {
    const value = (await this.settings())[key];
    if (value === undefined || value === '' || isNaN(Number(value))) {
      throw new Error(`Billing setting ${key} is not configured`);
    }
    return Number(value);
  }

  async topUpRules() {
    const settings = await this.settings();
    const minAmount = await this.numberSetting(BILLING.minTopUp);
    const options = numberList(settings[BILLING.topUpOptions]).filter(
      (v) => v >= minAmount
    );
    // The auto top-up form's choices. Optional: without them the form offers
    // nothing preset (nothing here gives credit away).
    const threshold = settings[BILLING.autoTopUpThreshold];
    return {
      minAmount,
      options,
      creditsPerUnit: await this.numberSetting(BILLING.creditsPerUnit),
      autoOptions: numberList(settings[BILLING.autoTopUpOptions]).filter(
        (v) => v >= minAmount
      ),
      capOptions: numberList(settings[BILLING.autoTopUpCapOptions]).filter(
        (v) => v > 0
      ),
      defaultThreshold:
        threshold !== undefined && threshold !== '' && !isNaN(Number(threshold))
          ? Number(threshold)
          : null,
    };
  }

  async currency() {
    const value = (await this.settings())[BILLING.currency];
    if (!value) {
      throw new Error(`Billing setting ${BILLING.currency} is not configured`);
    }
    return value.toUpperCase();
  }

  // An amount in the smallest unit of the wallet's currency, for messages.
  async formatMoney(amount: number) {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: await this.currency(),
    }).format(amount / 100);
  }

  // Smallest currency units in one whole unit of the wallet currency (100
  // cents in a dollar).
  async minorPerUnit() {
    const digits =
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: await this.currency(),
      }).resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** digits;
  }

  // Top-ups are whole units of the currency (whole dollars).
  async isWholeAmount(amount: number) {
    return (
      Number.isInteger(amount) && amount % (await this.minorPerUnit()) === 0
    );
  }

  async wholeAmountMessage() {
    const example = await this.formatMoney(await this.minorPerUnit());
    return `Top-ups are in whole ${await this.currency()} amounts, for example ${example}`;
  }

  // Units of credit bought with an amount in the smallest unit of the
  // wallet's currency (cents for USD).
  async unitsForAmount(amount: number) {
    return amount * (await this.numberSetting(BILLING.creditsPerUnit));
  }

  // The price of one unit of an action, in units of credit, rounded up.
  async priceOf(action: BillableAction) {
    if (action.fixedPrice !== null && action.fixedPrice !== undefined) {
      return action.fixedPrice;
    }

    const settings = await this.settings();
    const fx =
      action.costCurrency.toUpperCase() === (await this.currency())
        ? '1'
        : settings[BILLING.fxPrefix + action.costCurrency.toUpperCase()];
    if (!fx) {
      throw new Error(`No exchange rate for ${action.costCurrency}`);
    }

    const multiplierBp =
      action.multiplierBp ??
      (await this.numberSetting(BILLING.defaultMultiplierBp));
    const creditsPerUnit = await this.numberSetting(BILLING.creditsPerUnit);

    // cost (millionths) x fx (millionths) x multiplier (bp) x credits per
    // currency unit x 100
    return Number(
      ceilDiv(
        BigInt(action.costMicros) *
          BigInt(toMicros(fx)) *
          BigInt(multiplierBp) *
          BigInt(creditsPerUnit) *
          BigInt(100),
        BigInt(1_000_000) * BigInt(1_000_000) * BigInt(10_000)
      )
    );
  }

  async price(actionKey: string) {
    const action = (await this.actions()).find((a) => a.key === actionKey);
    if (!action || !action.active) {
      return undefined;
    }
    return { action, price: await this.priceOf(action) };
  }

  // The price list grouped into its sections, in order. Every word on the
  // page is generated from these fields, so a new row needs no new copy.
  async priceSections(provider?: string) {
    const [actions, categories] = await Promise.all([
      this.priceList(provider),
      this._wallet.categories(),
    ]);
    const order = new Map(categories.map((c) => [c.key, c.sortOrder]));
    const keys = [...new Set(actions.map((a) => a.category || 'other'))].sort(
      (a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)
    );
    return keys.map((key) => ({
      key,
      actions: actions.filter((a) => (a.category || 'other') === key),
    }));
  }

  async priceList(provider?: string): Promise<PricedAction[]> {
    const actions = (await this.actions()).filter(
      (a) => !provider || a.provider === provider
    );
    return Promise.all(
      actions.map(async (a) => ({
        key: a.key,
        provider: a.provider,
        category: a.category,
        name: a.name,
        description: a.description,
        unit: a.unit,
        freeUnits: a.freeUnits,
        freePeriod: a.freePeriod,
        billing: a.billing,
        requiresTopUp: a.requiresTopUp,
        price: a.billing === 'UNLOCK' ? 0 : await this.priceOf(a),
      }))
    );
  }

  getWallet(organizationId: string) {
    return this._wallet.getWallet(organizationId);
  }

  getWalletByCustomer(stripeCustomerId: string) {
    return this._wallet.getWalletByCustomer(stripeCustomerId);
  }

  ensureWallet(organizationId: string) {
    return this._wallet.ensureWallet(organizationId);
  }

  updateWallet(
    organizationId: string,
    data: Parameters<WalletRepository['updateWallet']>[1]
  ) {
    return this._wallet.updateWallet(organizationId, data);
  }

  balance(organizationId: string) {
    return this._wallet.balance(organizationId);
  }

  // See WalletRepository.standingChargesOf.
  standingChargesOf(organizationId: string, actionKey: string) {
    return this._wallet.standingChargesOf(organizationId, actionKey);
  }

  // The charge standing for one chargeKey (charged and not refunded), if any.
  async standingCharge(organizationId: string, chargeKey: string) {
    return (
      await this._wallet.standingCharges(organizationId, [chargeKey])
    ).get(chargeKey);
  }

  // Whether the paid features are open (pay-as-you-go): with Plus, for a
  // workspace that topped up before Plus launched, or for one whose Plus
  // ended until its balance runs out (it keeps what it paid for, nothing
  // more). Off while the wallet is frozen (a payment was refunded or
  // disputed). Every gate reads this one predicate.
  async isPayAsYouGo(organizationId: string) {
    return (await this.access(organizationId)).open;
  }

  async hasPlus(organizationId: string) {
    return plusIsActive(await this._wallet.getWallet(organizationId));
  }

  // When Plus launched (PLUS.launchAt), or undefined when it is unset or not
  // a date.
  async plusLaunchAt() {
    const value = (await this.settings())[PLUS.launchAt];
    const at = value ? new Date(value) : undefined;
    return at && !isNaN(at.getTime()) ? at : undefined;
  }

  // Pay-as-you-go from before Plus: the first top-up came before Plus
  // launched. Without the launch setting every wallet that topped up counts,
  // so a missing row never cuts off a workspace that paid.
  async fromBeforePlus(
    wallet: Pick<Wallet, 'firstTopUpAt'> | null | undefined
  ) {
    if (!wallet?.firstTopUpAt) {
      return false;
    }
    const launchAt = await this.plusLaunchAt();
    return !launchAt || wallet.firstTopUpAt.getTime() < launchAt.getTime();
  }

  // Whether a wallet may buy top-ups and use auto top-up: Plus, or
  // pay-as-you-go from before Plus. Never while it is on hold.
  async walletTopUpAllowed(
    wallet:
      | Pick<
          Wallet,
          | 'plusSubscriptionId'
          | 'plusStatus'
          | 'plusPeriodEnd'
          | 'frozenAt'
          | 'firstTopUpAt'
        >
      | null
      | undefined
  ) {
    return (
      plusIsActive(wallet) ||
      (!wallet?.frozenAt && (await this.fromBeforePlus(wallet)))
    );
  }

  async topUpAllowed(organizationId: string) {
    return this.walletTopUpAllowed(
      await this._wallet.getWallet(organizationId)
    );
  }

  // What the workspace can do, derived from the wallet, the launch setting
  // and the ledger every time (nothing is stored):
  // - plus: Plus is on (plan credits first).
  // - legacy: topped up before Plus launched, without Plus now: top-ups,
  //   auto top-up and the paid features stay open as before Plus.
  // - grandfathered: neither, but topped up (its Plus ended): open until
  //   the balance runs out, no new top-ups.
  async access(organizationId: string) {
    const wallet = await this._wallet.getWallet(organizationId);
    const frozen = !!wallet?.frozenAt;
    const plus = plusIsActive(wallet);
    const legacy = !plus && (await this.fromBeforePlus(wallet));
    const grandfathered =
      !plus &&
      !legacy &&
      !frozen &&
      !!wallet?.firstTopUpAt &&
      (await this.balance(organizationId)) > 0;
    return {
      plus,
      legacy,
      grandfathered,
      frozen,
      open: plus || (legacy && !frozen) || grandfathered,
      topUpAllowed: plus || (legacy && !frozen),
    };
  }

  async isFrozen(organizationId: string) {
    return !!(await this._wallet.getWallet(organizationId))?.frozenAt;
  }

  // What a top-up opens is decided by the price rows alone: an active row
  // with requiresTopUp opens its provider (a channel such as x, or a feature
  // such as brief or skills) to a pay-as-you-go workspace. Nothing without
  // such a row is ever opened.
  private async topUpKeys() {
    const keys = new Set<string>();
    for (const action of await this.actions()) {
      if (action.requiresTopUp) {
        keys.add(action.provider);
      }
    }
    return keys;
  }

  // The 402 for a provider the free plan locks: a wallet top-up when the
  // wallet charges for it, otherwise the given plan message.
  async providerLocked(
    organizationId: string,
    identifier: string,
    planMessage: string
  ) {
    if (!(await this.billsProvider(identifier))) {
      return new HttpException(planMessage, 402);
    }
    return (await this.isFrozen(organizationId))
      ? walletPaymentRequired(walletFrozenMessage())
      : plusRequired(walletRequiredMessage(identifier));
  }

  // Whether the wallet charges for this provider (so its lock says "top up").
  async billsProvider(identifier: string) {
    return (await this.topUpKeys()).has(providerOf(identifier));
  }

  // Why a provider the free plan locks is refused for this workspace: the
  // wallet is on hold, a top-up is needed, or (no price row opens it) only a
  // paid plan opens it.
  async lockedProviderMessageFor(organizationId: string, identifier: string) {
    if (!(await this.billsProvider(identifier))) {
      return paidOnlyChannelMessage();
    }
    return (await this.isFrozen(organizationId))
      ? walletFrozenMessage()
      : walletRequiredMessage(identifier);
  }

  // Superadmin: lifts the hold a refund or dispute put on a wallet. Auto
  // top-up stays off until the workspace turns it back on.
  async unfreeze(organizationId: string) {
    const wallet = await this._wallet.getWallet(organizationId);
    if (!wallet) {
      return undefined;
    }
    if (wallet.frozenAt) {
      await this._wallet.updateWallet(organizationId, { frozenAt: null });
    }
    return { wasFrozen: !!wallet.frozenAt };
  }

  // The providers and features this workspace's top-up has opened.
  async unlockedKeys(organizationId: string) {
    return (await this.isPayAsYouGo(organizationId))
      ? [...(await this.topUpKeys())]
      : [];
  }

  async unlocks(organizationId: string, key: string) {
    return (await this.unlockedKeys(organizationId)).includes(key);
  }

  // A provider the free plan locks is open to a pay-as-you-go workspace when
  // a price row opens it.
  unlocksProvider(organizationId: string, identifier: string) {
    return this.unlocks(organizationId, providerOf(identifier));
  }

  entries(
    organizationId: string,
    page = 0,
    size = 20,
    types?: WalletEntryType[]
  ) {
    return this._wallet.entries(
      organizationId,
      page,
      Math.min(size, 100),
      types
    );
  }

  async usage(organizationId: string, since: Date) {
    const [rows, daily, actions] = await Promise.all([
      this._wallet.usage(organizationId, since),
      this._wallet.daily(organizationId, since),
      this._wallet.actions(true),
    ]);
    const names = Object.fromEntries(actions.map((a) => [a.key, a.name]));
    const days: Record<string, number> = {};
    for (const entry of daily) {
      const day = entry.createdAt.toISOString().slice(0, 10);
      days[day] = (days[day] || 0) - entry.amount;
    }
    return {
      byAction: rows.map((r) => ({
        key: r.actionKey,
        name: (r.actionKey && names[r.actionKey]) || r.actionKey,
        quantity: r._sum.quantity || 0,
        total: -(r._sum.amount || 0),
      })),
      byDay: Object.entries(days)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, total]) => ({ day, total })),
    };
  }

  // The free allowance of a per-use action, counted from the ledger: once
  // ever (ONCE) or per UTC calendar month (MONTH). Monthly-billed rows
  // (storage) apply their free amount to usage before charging, so it is not
  // applied again here.
  freeAllowance(action: BillableAction): FreeAllowance | undefined {
    if (action.billing !== 'PER_USE' || !action.freeUnits) {
      return undefined;
    }
    if (action.freePeriod === 'MONTH') {
      return { units: action.freeUnits, since: startOfUtcMonth() };
    }
    if (action.freePeriod === 'ONCE') {
      return { units: action.freeUnits };
    }
    return undefined;
  }

  // Free units of an action this workspace has left (this month for MONTH,
  // ever for ONCE), or null when the action has no free allowance.
  async freeUnitsRemaining(organizationId: string, actionKey: string) {
    const priced = await this.price(actionKey);
    const free = priced && this.freeAllowance(priced.action);
    if (!free) {
      return null;
    }
    const used = await this._wallet.usedUnits(
      organizationId,
      actionKey,
      free.since
    );
    return Math.max(0, free.units - used);
  }

  // A row charged by usage from outside the posting flow (the MCP gateway's
  // image and voice generation, its data runs): active and per use. A row
  // open without a top-up is paid by granted credits too (signup credits
  // included); a row that needs a top-up is quoted and charged only once the
  // workspace is pay-as-you-go (see quoteUsage's `locked`). Each use is one
  // ledger unit, so a free allowance on such a row counts uses (these rows
  // have none).
  async usageAction(actionKey: string) {
    const priced = await this.price(actionKey);
    return priced && priced.action.billing === 'PER_USE'
      ? priced.action
      : undefined;
  }

  // Whether a usage row is closed to this workspace: it needs a top-up and
  // the workspace has not made its first one (or its wallet is on hold).
  async usageLocked(organizationId: string, action: BillableAction) {
    return (
      action.requiresTopUp && !(await this.isPayAsYouGo(organizationId))
    );
  }

  // The price of `units` of a usage row (one image is 1; 350 characters of a
  // per-1k-characters row is 0.35), rounded up once. `costMicros` is what the
  // provider reported for this use, in the row's costCurrency: it replaces
  // the row's cost and keeps the row's markup. A fixed price is never
  // replaced.
  async usagePrice(action: BillableAction, units: number, costMicros?: number) {
    if (action.fixedPrice !== null && action.fixedPrice !== undefined) {
      return Math.ceil(action.fixedPrice * units);
    }
    return this.priceOf({
      ...action,
      costMicros:
        costMicros && costMicros > 0
          ? Math.ceil(costMicros)
          : Math.ceil(action.costMicros * units),
    });
  }

  // Whether this workspace can pay for `units` of a usage row before the
  // work is done: the price, the balance, `short` when the balance plus
  // what auto top-up can still add does not cover it, and `locked` when the
  // row needs Plus and this workspace has no access. undefined when the
  // row is not charged by usage.
  async quoteUsage(organizationId: string, actionKey: string, units: number) {
    const action = await this.usageAction(actionKey);
    if (!action) {
      return undefined;
    }
    await this.syncPlan(organizationId);
    const [price, balance, frozen, locked] = await Promise.all([
      this.usagePrice(action, units),
      this.balance(organizationId),
      this.isFrozen(organizationId),
      this.usageLocked(organizationId, action),
    ]);
    const short =
      price > balance &&
      price > balance + (await this.autoTopUpHeadroom(organizationId));
    return { action, price, balance, frozen, short, locked };
  }

  // Charges an action once per chargeKey (see WalletRepository.spend). Units
  // still in the action's free allowance cost nothing (a fully free charge is
  // a zero "Included free" entry). Throws InsufficientCreditsError when the
  // balance does not cover it, and an Error when the action has no price, so
  // nothing is ever given away by accident. Refund with the returned entry's
  // idempotencyKey.
  async charge(params: {
    organizationId: string;
    actionKey: string;
    chargeKey: string;
    quantity?: number;
    reference?: string;
    description?: string;
    // Charge even into a negative balance (see WalletRepository.spend).
    allowNegative?: boolean;
    // The price of one unit worked out for this charge (usagePrice), in
    // place of the row's.
    unitPrice?: number;
  }) {
    const priced = await this.price(params.actionKey);
    if (!priced) {
      throw new Error(`No price for ${params.actionKey}`);
    }
    await this.syncPlan(params.organizationId);
    const quantity = params.quantity ?? 1;
    const unitPrice = params.unitPrice ?? priced.price;
    return this._wallet.spend({
      organizationId: params.organizationId,
      amount: unitPrice * quantity,
      type: 'SPEND',
      actionKey: params.actionKey,
      quantity,
      unitPrice,
      description: params.description || priced.action.name,
      chargeKey: params.chargeKey,
      allowNegative: params.allowNegative,
      reference: params.reference,
      free: this.freeAllowance(priced.action),
    });
  }

  // Charges `unitsPerItem` units of an action for each item not already
  // charged under `chargePrefix` (see WalletRepository.spendItems). Returns
  // the ledger entry, or null when every item was already paid for.
  async chargeItems(params: {
    organizationId: string;
    actionKey: string;
    chargePrefix: string;
    items: string[];
    unitsPerItem: number;
    reference?: string;
    description?: string;
    allowNegative?: boolean;
  }) {
    const priced = await this.price(params.actionKey);
    if (!priced) {
      throw new Error(`No price for ${params.actionKey}`);
    }
    if (!params.items.length || params.unitsPerItem < 1) {
      return null;
    }
    await this.syncPlan(params.organizationId);
    return this._wallet.spendItems({
      organizationId: params.organizationId,
      type: 'SPEND',
      actionKey: params.actionKey,
      unitPrice: priced.price,
      description: params.description || priced.action.name,
      chargePrefix: params.chargePrefix,
      items: params.items,
      unitsPerItem: params.unitsPerItem,
      allowNegative: params.allowNegative,
      reference: params.reference,
      free: this.freeAllowance(priced.action),
    });
  }

  // Gives back a charge, once. Does nothing if the charge never happened. A
  // free charge is refunded at zero, which gives its free unit back.
  async refund(chargeKey: string, reason?: string) {
    const charge = await this._wallet.entryByKey(chargeKey);
    if (!charge || charge.type !== 'SPEND' || charge.amount > 0) {
      return undefined;
    }
    return this._wallet.add({
      organizationId: charge.organizationId,
      amount: -charge.amount,
      type: 'REFUND',
      actionKey: charge.actionKey || undefined,
      quantity: -charge.quantity,
      unitPrice: charge.unitPrice || undefined,
      description: reason || `Refund: ${charge.description}`,
      idempotencyKey: `refund:${chargeKey}`,
      reference: charge.reference || undefined,
    });
  }

  // The live rates every price is worked out with, for the MCP gateway's own
  // quotes: credits for one unit of the wallet currency and the default
  // markup. Throws when they are not configured.
  async rates() {
    const [currency, creditsPerUnit, defaultMultiplierBp] = await Promise.all([
      this.currency(),
      this.numberSetting(BILLING.creditsPerUnit),
      this.numberSetting(BILLING.defaultMultiplierBp),
    ]);
    return {
      currency,
      creditsPerUnit,
      defaultMultiplierBp,
      defaultMultiplier: defaultMultiplierBp / 10_000,
    };
  }

  // Brings the Plus credits in the ledger up to date, lazily: every plan
  // period that has ended gets what is left of its credits taken back
  // (PLAN_EXPIRE), then the period running now gets its credits
  // (PLAN_GRANT) once its span's invoice is paid, once each by key. Plan
  // credits are spent first, so what is left of a period's grant is the
  // grant less what was spent from it (see planLeft), never more than the
  // grant. Runs before every charge and quote, on the wallet
  // and Plus pages and hourly; safe to run any time. Never throws.
  async syncPlan(organizationId: string) {
    try {
      const wallet = await this._wallet.getWallet(organizationId);
      if (!wallet?.plusSubscriptionId) {
        return;
      }
      const now = new Date();
      for (const grant of await this.openPlanGrants(organizationId)) {
        const end = this.planGrantEnd(wallet, grant, now);
        if (!end || end.getTime() > now.getTime() || !grant.idempotencyKey) {
          continue;
        }
        const left = await this.planLeft(organizationId, grant, end);
        await this._wallet.addOnce({
          organizationId,
          amount: -left,
          type: 'PLAN_EXPIRE',
          description: 'Unused plan credits expired',
          idempotencyKey: planExpireKey(grant.idempotencyKey),
          reference: grant.idempotencyKey,
        });
      }

      // A span's credits come once its invoice is paid, never while the
      // renewal is still being collected.
      const current = this.currentPlanPeriod(wallet, now);
      if (
        !current ||
        !plusSpanPaid(wallet) ||
        !wallet.plusCredits ||
        wallet.plusCredits <= 0
      ) {
        return;
      }
      let grantKey = planGrantKey(
        organizationId,
        wallet.plusSubscriptionId,
        wallet.plusPeriodStart!,
        current.index
      );
      // A grant of this period taken back before its end (written before
      // its span was paid, then its payment failed): now that the span is
      // paid, the period is granted once more, under its own key.
      const expired = await this._wallet.entryByKey(planExpireKey(grantKey));
      if (expired && expired.createdAt.getTime() < current.end.getTime()) {
        grantKey = `${grantKey}:paid`;
      }
      await this._wallet.addOnce({
        organizationId,
        amount: wallet.plusCredits,
        type: 'PLAN_GRANT',
        description: 'Plus credits',
        idempotencyKey: grantKey,
        reference: wallet.plusSubscriptionId,
        meta: JSON.stringify({
          subscriptionId: wallet.plusSubscriptionId,
          start: current.start.toISOString(),
          end: current.end.toISOString(),
          index: current.index,
        }),
      });
    } catch (err) {
      this._logger.error(
        `Plan credits for ${organizationId} could not be synced: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // The plan period running now, while Plus is on.
  currentPlanPeriod(wallet: Wallet, now = new Date()) {
    if (
      !plusIsActive(wallet, now) ||
      !wallet.plusPeriodStart ||
      !wallet.plusPeriodEnd ||
      !wallet.plusPeriodDays
    ) {
      return undefined;
    }
    return planPeriods(
      wallet.plusPeriodStart,
      wallet.plusPeriodEnd,
      wallet.plusPeriodDays
    ).find(
      (p) =>
        p.start.getTime() <= now.getTime() && now.getTime() < p.end.getTime()
    );
  }

  // When a grant's credits end: its period's end, or earlier when its
  // subscription's paid span was cut short (ended at once), or now when it
  // is of the span being collected after a failed payment (those credits
  // were never paid for).
  private planGrantEnd(wallet: Wallet, grant: WalletEntry, now = new Date()) {
    const period = planGrantPeriod(grant);
    if (!period) {
      return undefined;
    }
    if (
      period.subscriptionId === wallet.plusSubscriptionId &&
      plusPaymentFailed(wallet) &&
      !plusSpanPaid(wallet) &&
      wallet.plusPeriodStart &&
      period.start.getTime() >= wallet.plusPeriodStart.getTime() &&
      period.start.getTime() <= now.getTime()
    ) {
      return now;
    }
    if (
      period.subscriptionId === wallet.plusSubscriptionId &&
      wallet.plusPeriodEnd &&
      wallet.plusPeriodEnd.getTime() < period.end.getTime() &&
      wallet.plusPeriodEnd.getTime() >= period.start.getTime()
    ) {
      return wallet.plusPeriodEnd;
    }
    return period.end;
  }

  // Plan grants whose leftover has not been taken back yet.
  private async openPlanGrants(organizationId: string) {
    const grants = await this._wallet.planGrants(organizationId);
    if (!grants.length) {
      return [];
    }
    const closed = new Set(
      (
        await this._wallet.entriesByKeys(
          grants
            .filter((g) => g.idempotencyKey)
            .map((g) => planExpireKey(g.idempotencyKey!))
        )
      ).map((e) => e.reference)
    );
    return grants.filter((g) => !closed.has(g.idempotencyKey));
  }

  // What is left of a plan grant that ends at `end`: the grant less what was
  // spent (net of those spends' own refunds) since the grant was written,
  // between zero and the grant, so top-up credits are never taken with it.
  // Spends before it (a late webhook, a backdated start) were paid from
  // other credits, so they never count against it, nor do refunds of them.
  // A grant that runs to its period's end counts the spends up to that end;
  // one cut short (a cancel at once, a payment taken back), or ending before
  // it was written, counts every spend since it was written, because each
  // was made while the grant was still open, whenever the cut is dated.
  private async planLeft(
    organizationId: string,
    grant: WalletEntry,
    end: Date
  ) {
    const period = planGrantPeriod(grant);
    const now = Date.now() + 1;
    const ranToItsEnd =
      !!period &&
      end.getTime() >= period.end.getTime() &&
      end.getTime() > grant.createdAt.getTime();
    const to = new Date(ranToItsEnd ? Math.min(end.getTime(), now) : now);
    const [spent, balance] = await Promise.all([
      this._wallet.spentBetween(organizationId, grant.createdAt, to),
      this._wallet.balanceBefore(organizationId, to),
    ]);
    return Math.max(0, Math.min(grant.amount - spent, grant.amount, balance));
  }

  // The balance split in two, for the wallet and Plus pages: plan credits
  // (this period's, gone at planResetsAt) and the rest (top-ups, welcome and
  // granted credits, which never expire). Hundredths of a credit.
  async planCredits(organizationId: string) {
    await this.syncPlan(organizationId);
    const [wallet, balance] = await Promise.all([
      this._wallet.getWallet(organizationId),
      this.balance(organizationId),
    ]);
    const now = new Date();
    let plan = 0;
    let planResetsAt: Date | null = null;
    if (wallet) {
      for (const grant of await this.openPlanGrants(organizationId)) {
        const period = planGrantPeriod(grant);
        const end = this.planGrantEnd(wallet, grant, now);
        if (!period || !end || end.getTime() <= now.getTime()) {
          continue;
        }
        plan += await this.planLeft(organizationId, grant, end);
        planResetsAt =
          !planResetsAt || end.getTime() < planResetsAt.getTime()
            ? end
            : planResetsAt;
      }
    }
    plan = Math.max(0, Math.min(plan, balance));
    return { balance, plan, topUp: balance - plan, planResetsAt };
  }

  // Every wallet that ever had Plus, for the hourly plan sync.
  plusWallets() {
    return this._wallet.plusWallets();
  }

  // Records a paid top-up once per Stripe payment, and starts pay-as-you-go.
  // `credits` and `currency` are what was fixed when the payment was created
  // (Stripe metadata), never recomputed from today's settings.
  async addTopUp(params: {
    organizationId: string;
    amount: number;
    credits: number;
    currency: string;
    auto: boolean;
    paymentIntentId: string;
    // Stripe's receipt for the payment, shown on the transaction.
    receiptUrl?: string | null;
  }) {
    const { entry, created } = await this._wallet.addOnce({
      organizationId: params.organizationId,
      amount: params.credits,
      type: params.auto ? 'AUTO_TOPUP' : 'TOPUP',
      description: params.auto ? 'Auto top-up' : 'Top-up',
      paidAmount: params.amount,
      currency: params.currency.toUpperCase(),
      idempotencyKey: `topup:${params.paymentIntentId}`,
      reference: params.paymentIntentId,
      meta: params.receiptUrl
        ? JSON.stringify({ receiptUrl: params.receiptUrl })
        : undefined,
    });
    const wallet = await this._wallet.ensureWallet(params.organizationId);
    if (!wallet.firstTopUpAt || !wallet.currency) {
      await this._wallet.updateWallet(params.organizationId, {
        firstTopUpAt: wallet.firstTopUpAt || new Date(),
        currency: wallet.currency || params.currency.toUpperCase(),
      });
    }
    // In the bell, once per payment (the webhook and the browser's return
    // both credit it).
    if (created) {
      const label = params.auto ? 'Automatic top-up' : 'Top-up';
      await this.notify(
        params.organizationId,
        label,
        `${label}: ${formatCredits(
          params.credits
        )} credits added to your wallet (${formatPaid(
          params.amount,
          params.currency
        )}).`,
        'success'
      );
    }
    return entry;
  }

  // An in-app notification (the bell). Never emails, never fails the caller.
  async notify(
    organizationId: string,
    subject: string,
    message: string,
    type: 'success' | 'fail' | 'info' = 'info'
  ) {
    try {
      await this._notifications.inAppNotification(
        organizationId,
        subject,
        message,
        false,
        false,
        type
      );
    } catch (err) {
      this._logger.error(`Could not notify ${organizationId}: ${err}`);
    }
  }

  autoTopUpSpentSince(organizationId: string, since: Date) {
    return this._wallet.autoTopUpSpentSince(organizationId, since);
  }

  // Whether this workspace pays from its wallet: pay-as-you-go and not on a
  // paid plan (paid plans are never charged).
  async paysFromWallet(organizationId: string) {
    if (!(await this.isPayAsYouGo(organizationId))) {
      return false;
    }
    return !hasAccess(
      await this._wallet.organizationSubscription(organizationId)
    );
  }

  // Providers whose posts are charged per post: those with an active
  // per-use <provider>.post row (X today).
  async postProviders() {
    return (await this.actions())
      .filter((a) => a.billing === 'PER_USE' && a.key === `${a.provider}.post`)
      .map((a) => a.provider);
  }

  // The one rule for what a post is charged as: `<provider>.post_link` when
  // the text carries a link (X's URL rules, bare domains included, and a
  // "(post:<id>)" reference counts as the URL it becomes) and that row is
  // priced, else `<provider>.post`.
  //
  // `sent: true` means `content` is the exact text sent to the network (plain
  // text, links already stripped). Otherwise it is the stored post (HTML or
  // text): it is turned into text and, for X with STRIP_LINKS_FROM_X_POSTS,
  // has its links stripped the way the X provider will.
  async postActionKey(
    identifier: string,
    content: string,
    options: { sent?: boolean } = {}
  ) {
    const provider = providerOf(identifier);
    let text = content || '';
    if (!options.sent) {
      text = stripHtmlValidation(
        'normal',
        text,
        true,
        false,
        !/<\/?[a-z][\s\S]*>/i.test(text)
      ).replace(POST_REFERENCE_REGEX, referenceUrlPlaceholder);
      if (provider === 'x' && process.env.STRIP_LINKS_FROM_X_POSTS) {
        text = stripLinks(text);
      }
    }
    if (textHasLink(text) && (await this.price(`${provider}.post_link`))) {
      return `${provider}.post_link`;
    }
    return `${provider}.post`;
  }

  // What auto top-up can still do this month: the credits one top-up adds,
  // how many top-ups the monthly limit still allows (Infinity without one),
  // and the amount charged each time. Zero when it is off, frozen or has no
  // saved card.
  async autoTopUpRoom(organizationId: string) {
    const none = { perTopUp: 0, topUps: 0, amount: 0 };
    const wallet = await this._wallet.getWallet(organizationId);
    if (
      !wallet?.autoTopUp ||
      wallet.frozenAt ||
      !wallet.paymentMethodId ||
      !wallet.autoTopUpAmount ||
      // Top-ups need Plus (or pay-as-you-go from before Plus), and the card
      // of a failing Plus payment is not charged again.
      plusPaymentFailed(wallet) ||
      !(await this.walletTopUpAllowed(wallet))
    ) {
      return none;
    }
    const perTopUp = await this.unitsForAmount(wallet.autoTopUpAmount);
    if (!wallet.autoTopUpMonthlyCap) {
      return { perTopUp, topUps: Infinity, amount: wallet.autoTopUpAmount };
    }
    const spent = await this.autoTopUpSpentSince(
      organizationId,
      dayjs().startOf('month').toDate()
    );
    return {
      perTopUp,
      topUps: Math.floor(
        Math.max(0, wallet.autoTopUpMonthlyCap - spent) /
          wallet.autoTopUpAmount
      ),
      amount: wallet.autoTopUpAmount,
    };
  }

  // Credits auto top-up could still add this month, or Infinity without a
  // monthly limit. Zero when it is off or has no saved card.
  async autoTopUpHeadroom(organizationId: string) {
    const room = await this.autoTopUpRoom(organizationId);
    return room.topUps === Infinity ? Infinity : room.topUps * room.perTopUp;
  }

  // Paid usage due in the next 48 hours that is not paid for yet, priced
  // now. Posts are paid when they are scheduled, so this is what is still to
  // come: each next occurrence of a repeating post, and any post queued
  // before charging moved to scheduling time (paid when it publishes).
  // `short` means the balance plus what auto top-up can still add does not
  // cover it.
  async forecast(organizationId: string): Promise<Forecast> {
    const empty: Forecast = {
      windowHours: FORECAST_HOURS,
      needed: 0,
      short: false,
      items: [],
    };
    if (!(await this.paysFromWallet(organizationId))) {
      return empty;
    }
    const providers = await this.postProviders();
    if (!providers.length) {
      return empty;
    }

    const now = dayjs();
    const end = now.add(FORECAST_HOURS, 'hour');
    const [posts, repeating] = await Promise.all([
      this._wallet.scheduledPosts(
        organizationId,
        providers,
        now.toDate(),
        end.toDate()
      ),
      this._wallet.repeatingPosts(organizationId, providers),
    ]);
    const paid = await this._wallet.standingCharges(
      organizationId,
      posts.map((p) => postChargeKey(p.id))
    );

    const due: { id: string; content: string; identifier: string; at: Date }[] =
      posts
        .filter((p) => !paid.has(postChargeKey(p.id)))
        .map((p) => ({
          id: p.id,
          content: p.content,
          identifier: p.integration.providerIdentifier,
          at: p.publishDate,
        }));
    // The next occurrence of each repeating post, if it falls in the window.
    // A thread repeats while its first post is queued or published.
    const mainState = new Map(
      repeating.filter((p) => !p.parentPostId).map((p) => [p.group, p.state])
    );
    for (const post of repeating) {
      const state = mainState.get(post.group);
      if (!state || !post.intervalInDays) {
        continue;
      }
      let next = dayjs(post.publishDate).add(post.intervalInDays, 'day');
      while (next.isBefore(now)) {
        next = next.add(post.intervalInDays, 'day');
      }
      if (next.isAfter(end)) {
        continue;
      }
      due.push({
        id: post.id,
        content: post.content,
        identifier: post.integration.providerIdentifier,
        at: next.toDate(),
      });
    }
    due.sort((a, b) => a.at.getTime() - b.at.getTime());

    const items: ForecastItem[] = [];
    let needed = 0;
    for (const post of due) {
      const actionKey = await this.postActionKey(post.identifier, post.content);
      const priced = await this.price(actionKey);
      if (!priced) {
        continue;
      }
      needed += priced.price;
      items.push({ actionKey, quantity: 1, at: post.at, postId: post.id });
    }

    const balance = await this.balance(organizationId);
    return {
      windowHours: FORECAST_HOURS,
      needed,
      short:
        needed > balance &&
        needed > balance + (await this.autoTopUpHeadroom(organizationId)),
      items,
    };
  }

  // One prospective charge, for the composer's cost line. `short` counts the
  // usage already scheduled in the forecast window too.
  async estimate(organizationId: string, actionKey: string, quantity = 1) {
    const priced = await this.price(actionKey);
    if (!priced) {
      return undefined;
    }
    const result = await this.estimateTotal(organizationId, [
      { actionKey, price: priced.price * quantity },
    ]);
    return {
      price: result.price,
      balanceAfter: result.balanceAfter,
      short: result.short,
    };
  }

  // A post and its replies on one channel, priced with the same link rule
  // that charges them, for the composer and the MCP. Channels the wallet
  // does not charge give no items and a price of 0. Units still in a free
  // allowance are priced at 0.
  //
  // Posts are charged when they are scheduled. `group` is the post being
  // edited: what it already paid is credited against the new price, so
  // `due` is what scheduling takes now (negative gives credits back). With
  // `inter` (repeat every n days) the price is per occurrence: each later
  // occurrence is charged when it goes out.
  async estimateContents(
    organizationId: string,
    identifier: string,
    contents: string[],
    options: { group?: string; inter?: number } = {}
  ): Promise<Estimate> {
    const items: EstimateItem[] = [];
    const freeLeft = new Map<string, number | null>();
    for (const content of contents) {
      const actionKey = await this.postActionKey(identifier, content);
      const priced = await this.price(actionKey);
      if (!priced) {
        continue;
      }
      if (!freeLeft.has(actionKey)) {
        freeLeft.set(
          actionKey,
          await this.freeUnitsRemaining(organizationId, actionKey)
        );
      }
      const left = freeLeft.get(actionKey);
      if (left) {
        freeLeft.set(actionKey, left - 1);
        items.push({ actionKey, price: 0 });
        continue;
      }
      items.push({ actionKey, price: priced.price });
    }
    const alreadyPaid = options.group
      ? await this.paidForGroup(organizationId, options.group)
      : 0;
    return {
      ...(await this.estimateTotal(organizationId, items, alreadyPaid)),
      perOccurrence: !!options.inter && options.inter > 0,
      repeatEveryDays:
        options.inter && options.inter > 0 ? Math.floor(options.inter) : null,
    };
  }

  // Credits standing for the unpublished posts of a group (what deleting,
  // drafting or re-pricing it would give back).
  async paidForGroup(organizationId: string, group: string) {
    const rows = await this._wallet.postsInGroups(organizationId, [group]);
    const standing = await this._wallet.standingCharges(
      organizationId,
      rows.filter((r) => !postWasSent(r)).map((r) => postChargeKey(r.id))
    );
    return [...standing.values()].reduce((sum, e) => sum - e.amount, 0);
  }

  // Totals priced items against the balance and what auto top-up can still
  // add this month. `alreadyPaid` is credit standing for what these items
  // replace (an edit), so only the difference is due now.
  private async estimateTotal(
    organizationId: string,
    items: EstimateItem[],
    alreadyPaid = 0
  ): Promise<Estimate> {
    const price = items.reduce((sum, item) => sum + item.price, 0);
    const due = price - alreadyPaid;
    // This period's plan credits count before anything is estimated.
    await this.syncPlan(organizationId);
    const [balance, room] = await Promise.all([
      this.balance(organizationId),
      this.autoTopUpRoom(organizationId),
    ]);
    const missing = due - balance;
    const topUpsNeeded =
      missing > 0 && room.perTopUp > 0 ? Math.ceil(missing / room.perTopUp) : 0;
    const autoCovers =
      missing > 0 && topUpsNeeded > 0 && topUpsNeeded <= room.topUps;
    return {
      items,
      price,
      alreadyPaid,
      due,
      balanceAfter: balance - due,
      short: missing > 0 && !autoCovers,
      autoCovers,
      autoAmount: autoCovers ? topUpsNeeded * room.amount : null,
    };
  }

  // Superadmin: give credits, optionally starting pay-as-you-go. A repeated
  // idempotencyKey returns the first entry instead of granting twice.
  async grant(params: {
    organizationId: string;
    credits: number;
    reason: string;
    actorId: string;
    unlock?: boolean;
    idempotencyKey?: string;
  }) {
    const entry = await this._wallet.add({
      organizationId: params.organizationId,
      amount: params.credits,
      type: 'GRANT',
      description: params.reason,
      actorId: params.actorId,
      idempotencyKey: params.idempotencyKey
        ? `admin:grant:${params.organizationId}:${params.idempotencyKey}`
        : undefined,
    });
    const wallet = await this._wallet.ensureWallet(params.organizationId);
    if (params.unlock && !wallet.firstTopUpAt) {
      await this._wallet.updateWallet(params.organizationId, {
        firstTopUpAt: new Date(),
      });
    }
    return entry;
  }

  // The welcome credits a workspace can claim (BILLING.signupCredits), and
  // whether it has claimed them or turned them down: either is final. Read
  // by the onboarding steps, so nothing is thrown: on a failure there is
  // nothing to claim.
  async welcomeCredits(organizationId: string) {
    try {
      const value = Number((await this.settings())[BILLING.signupCredits]);
      const total =
        Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
      const [entry, wallet] = await Promise.all([
        this._wallet.entryByKey(`welcome:${organizationId}`),
        this._wallet.getWallet(organizationId),
      ]);
      const claimed = !!entry;
      const skipped = !claimed && !!wallet?.welcomeCreditsSkippedAt;
      return { available: claimed || skipped ? 0 : total, claimed, skipped };
    } catch (err) {
      this._logger.error(
        `Welcome credits for ${organizationId} could not be read: ${
          err instanceof Error ? err.message : err
        }`
      );
      return { available: 0, claimed: false, skipped: false };
    }
  }

  // When the workspace claimed its welcome credits, or null. The early bird
  // starts then, or at the skip if that came first.
  async welcomeClaimedAt(organizationId: string) {
    return (
      (await this._wallet.entryByKey(`welcome:${organizationId}`))?.createdAt ||
      null
    );
  }

  // Gives the workspace the welcome credits it can still claim, at most once:
  // the entry's key is the same on every call, so a retry or a second click
  // gets the first entry back instead of a second grant. Returns what this
  // call added, in hundredths of a credit.
  async claimWelcomeCredits(organizationId: string) {
    const { available } = await this.welcomeCredits(organizationId);
    if (available <= 0) {
      return 0;
    }
    await this._wallet.ensureWallet(organizationId);
    const { created } = await this._wallet.addOnce({
      organizationId,
      amount: available,
      type: 'GRANT',
      description: 'Welcome credits',
      idempotencyKey: `welcome:${organizationId}`,
    });
    return created ? available : 0;
  }

  // Records that the workspace turned the welcome credits down, so they can
  // no longer be claimed. Nothing changes once they were claimed. Returns
  // whether this call recorded it.
  async skipWelcomeCredits(organizationId: string) {
    const { claimed, skipped } = await this.welcomeCredits(organizationId);
    if (claimed || skipped) {
      return false;
    }
    await this._wallet.ensureWallet(organizationId);
    await this._wallet.updateWallet(organizationId, {
      welcomeCreditsSkippedAt: new Date(),
    });
    return true;
  }

  // Superadmin: correct the balance either way; may take it below zero. A
  // repeated idempotencyKey returns the first entry.
  async adjust(params: {
    organizationId: string;
    credits: number;
    reason: string;
    actorId: string;
    idempotencyKey?: string;
  }) {
    await this._wallet.ensureWallet(params.organizationId);
    return this._wallet.add({
      organizationId: params.organizationId,
      amount: params.credits,
      type: 'ADJUST',
      description: params.reason,
      actorId: params.actorId,
      idempotencyKey: params.idempotencyKey
        ? `admin:adjust:${params.organizationId}:${params.idempotencyKey}`
        : undefined,
    });
  }

  // Top-ups recorded since a date and the entries for given payment ids,
  // for reconciling with Stripe.
  topUpsSince(since: Date) {
    return this._wallet.topUpsSince(since);
  }

  topUpEntries(paymentIntentIds: string[]) {
    return this._wallet.entriesByKeys(
      paymentIntentIds.map((id) => `topup:${id}`)
    );
  }

  // Records that today's short-forecast notice went out; false if it already
  // had today (UTC).
  private claimForecastNotice(organizationId: string) {
    const now = new Date();
    return this._wallet.claimForecastNotice(
      organizationId,
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      )
    );
  }

  // Superadmin: everything support needs to look at a wallet.
  async inspect(organizationId: string) {
    const [wallet, balance, [entries]] = await Promise.all([
      this._wallet.getWallet(organizationId),
      this.balance(organizationId),
      this._wallet.entries(organizationId, 0, 50),
    ]);
    return {
      balance,
      stripeCustomerId: wallet?.stripeCustomerId || null,
      wallet,
      entries,
    };
  }

  // One in-app notification per UTC day while the paid usage scheduled in
  // the forecast window can't be covered (balance plus what auto top-up can
  // still add). Pass a forecast already computed to save reading it again.
  // Returns whether a notification was sent.
  async notifyIfShort(organizationId: string, forecast?: Forecast) {
    const current = forecast || (await this.forecast(organizationId));
    if (!current.short) {
      return false;
    }
    const wallet = await this._wallet.getWallet(organizationId);
    const now = new Date();
    if (
      wallet?.forecastNotifiedAt &&
      wallet.forecastNotifiedAt.toISOString().slice(0, 10) ===
        now.toISOString().slice(0, 10)
    ) {
      return false;
    }
    if (!(await this.claimForecastNotice(organizationId))) {
      return false;
    }
    const balance = await this.balance(organizationId);
    try {
      await this._notifications.inAppNotification(
        organizationId,
        'Not enough credits for scheduled usage',
        `Scheduled usage in the next ${
          current.windowHours
        } hours needs ${formatCredits(
          current.needed
        )} credits. You have ${formatCredits(
          balance
        )}. Anything not covered won't go out. Top up your wallet to keep it on schedule.`,
        false,
        false,
        'fail'
      );
    } catch (err) {
      this._logger.error(
        `Could not notify ${organizationId} of a short forecast: ${err}`
      );
      return false;
    }
    return true;
  }

  // Takes back the credits of a refunded or disputed top-up, up to `share`
  // (0..1) of what that payment added, and freezes the wallet. Each Stripe
  // event is written once (idempotencyKey), and what an earlier refund already
  // took back is not taken twice. Returns undefined when the payment never
  // credited this ledger.
  async clawBack(params: {
    paymentIntentId: string;
    share: number;
    eventKey: string;
    description: string;
  }) {
    const topUp = await this._wallet.entryByKey(
      `topup:${params.paymentIntentId}`
    );
    if (!topUp) {
      return undefined;
    }
    const target = Math.ceil(
      topUp.amount * Math.min(1, Math.max(0, params.share))
    );
    const already = -(await this._wallet.clawedBack(
      topUp.organizationId,
      params.paymentIntentId
    ));
    const amount = Math.max(0, target - already);
    const entry = amount
      ? await this._wallet.add({
          organizationId: topUp.organizationId,
          amount: -amount,
          type: 'ADJUST',
          description: params.description,
          idempotencyKey: `chargeback:${params.paymentIntentId}:${params.eventKey}`,
          reference: params.paymentIntentId,
        })
      : undefined;
    await this.freeze(topUp.organizationId);
    return { organizationId: topUp.organizationId, credits: amount, entry };
  }

  // Puts the wallet on hold after a refund or dispute (auto top-up off too),
  // and tells the workspace the first time. Returns whether it was not on
  // hold before.
  async freeze(organizationId: string) {
    const wasFrozen = !!(await this._wallet.getWallet(organizationId))
      ?.frozenAt;
    await this._wallet.updateWallet(organizationId, {
      frozenAt: new Date(),
      autoTopUp: false,
    });
    if (!wasFrozen) {
      await this.notify(
        organizationId,
        'Wallet on hold',
        walletFrozenMessage(),
        'fail'
      );
    }
    return !wasFrozen;
  }

  // A refund or dispute of a Plus payment: what is left now of the
  // subscription's plan credits not yet expired is taken back, as each
  // grant's own PLAN_EXPIRE entry, so a repeat (or the period's end later)
  // takes nothing more. Periods that already ended expire first, as usual.
  // Returns the credits this call took back.
  async takeBackPlanCredits(
    organizationId: string,
    subscriptionId: string,
    description: string
  ) {
    await this.syncPlan(organizationId);
    const now = new Date();
    let taken = 0;
    for (const grant of await this.openPlanGrants(organizationId)) {
      const period = planGrantPeriod(grant);
      if (
        !period ||
        period.subscriptionId !== subscriptionId ||
        !grant.idempotencyKey
      ) {
        continue;
      }
      const left = await this.planLeft(organizationId, grant, now);
      const { created } = await this._wallet.addOnce({
        organizationId,
        amount: -left,
        type: 'PLAN_EXPIRE',
        description,
        idempotencyKey: planExpireKey(grant.idempotencyKey),
        reference: grant.idempotencyKey,
      });
      if (created) {
        taken += left;
      }
    }
    return taken;
  }
}
