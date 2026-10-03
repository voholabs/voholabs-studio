import { Injectable } from '@nestjs/common';
import { BillableAction } from '@prisma/client';
import {
  InsufficientCreditsError,
  WalletRepository,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.repository';

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
} as const;

const SETTINGS_TTL_MS = 30_000;

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

// Shown when a channel is charged from the wallet and the workspace has not
// topped up yet.
export const walletRequiredMessage = (identifier: string) =>
  `${providerLabel(
    identifier
  )} is charged per post from your wallet credits. Top up your wallet to use it.`;

export const notEnoughCreditsMessage = () =>
  'Not enough credits in your wallet. Top up to publish this post.';

const ceilDiv = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b;

@Injectable()
export class WalletService {
  private _settings?: { at: number; values: Record<string, string> };

  constructor(private _wallet: WalletRepository) {}

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
    const options = (settings[BILLING.topUpOptions] || '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => v >= minAmount);
    return {
      minAmount,
      options,
      creditsPerUnit: await this.numberSetting(BILLING.creditsPerUnit),
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
    const action = await this._wallet.action(actionKey);
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
    const actions = (await this._wallet.actions()).filter(
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

  // Pay-as-you-go starts with the first successful top-up.
  async isPayAsYouGo(organizationId: string) {
    return !!(await this._wallet.getWallet(organizationId))?.firstTopUpAt;
  }

  // What a top-up opens is decided by the price rows alone: an active row
  // with requiresTopUp opens its provider (a channel such as X) and its
  // category (a feature such as the brief) to a pay-as-you-go workspace.
  // Nothing without such a row is ever opened.
  private async topUpKeys() {
    const keys = new Set<string>();
    for (const action of await this._wallet.actions()) {
      if (action.requiresTopUp) {
        keys.add(action.provider);
        if (action.category) {
          keys.add(action.category);
        }
      }
    }
    return keys;
  }

  // Whether the wallet charges for this provider (so its lock says "top up").
  async billsProvider(identifier: string) {
    return (await this.topUpKeys()).has(providerOf(identifier));
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

  entries(organizationId: string, page = 0, size = 20) {
    return this._wallet.entries(organizationId, page, Math.min(size, 100));
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

  // Charges an action once per chargeKey (see WalletRepository.spend). Throws
  // InsufficientCreditsError when the balance does not cover it, and an Error
  // when the action has no price, so nothing is ever given away by accident.
  // Refund with the returned entry's idempotencyKey.
  async charge(params: {
    organizationId: string;
    actionKey: string;
    chargeKey: string;
    quantity?: number;
    reference?: string;
    description?: string;
    // Charge even into a negative balance (see WalletRepository.spend).
    allowNegative?: boolean;
  }) {
    const priced = await this.price(params.actionKey);
    if (!priced) {
      throw new Error(`No price for ${params.actionKey}`);
    }
    const quantity = params.quantity ?? 1;
    return this._wallet.spend({
      organizationId: params.organizationId,
      amount: priced.price * quantity,
      type: 'SPEND',
      actionKey: params.actionKey,
      quantity,
      unitPrice: priced.price,
      description: params.description || priced.action.name,
      chargeKey: params.chargeKey,
      allowNegative: params.allowNegative,
      reference: params.reference,
    });
  }

  // Gives back a charge, once. Does nothing if the charge never happened.
  async refund(chargeKey: string, reason?: string) {
    const charge = await this._wallet.entryByKey(chargeKey);
    if (!charge || charge.amount >= 0) {
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

  // Records a paid top-up once per Stripe payment, and starts pay-as-you-go.
  async addTopUp(params: {
    organizationId: string;
    amount: number;
    auto: boolean;
    paymentIntentId: string;
  }) {
    const units = await this.unitsForAmount(params.amount);
    const entry = await this._wallet.add({
      organizationId: params.organizationId,
      amount: units,
      type: params.auto ? 'AUTO_TOPUP' : 'TOPUP',
      description: params.auto ? 'Auto top-up' : 'Top-up',
      paidAmount: params.amount,
      currency: await this.currency(),
      idempotencyKey: `topup:${params.paymentIntentId}`,
      reference: params.paymentIntentId,
    });
    const wallet = await this._wallet.ensureWallet(params.organizationId);
    if (!wallet.firstTopUpAt) {
      await this._wallet.updateWallet(params.organizationId, {
        firstTopUpAt: new Date(),
      });
    }
    return entry;
  }

  autoTopUpSpentSince(organizationId: string, since: Date) {
    return this._wallet.autoTopUpSpentSince(organizationId, since);
  }
}
