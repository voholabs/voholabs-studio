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
  creditsPerGbp: 'credits_per_gbp',
  defaultMultiplierBp: 'default_multiplier_bp',
  // Exchange rate into GBP, e.g. fx.USD = "0.80".
  fxPrefix: 'fx.',
  minTopUpPence: 'min_topup_pence',
  topUpOptionsPence: 'topup_options_pence',
} as const;

const SETTINGS_TTL_MS = 30_000;

export interface PricedAction {
  key: string;
  provider: string;
  name: string;
  description: string | null;
  unit: string;
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
    const minPence = await this.numberSetting(BILLING.minTopUpPence);
    const optionsPence = (settings[BILLING.topUpOptionsPence] || '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => v >= minPence);
    return {
      minPence,
      optionsPence,
      creditsPerGbp: await this.numberSetting(BILLING.creditsPerGbp),
    };
  }

  // Units of credit bought with an amount in pence.
  async unitsForPence(pence: number) {
    return pence * (await this.numberSetting(BILLING.creditsPerGbp));
  }

  // The price of one unit of an action, in units of credit, rounded up.
  async priceOf(action: BillableAction) {
    if (action.fixedPrice !== null && action.fixedPrice !== undefined) {
      return action.fixedPrice;
    }

    const settings = await this.settings();
    const fx =
      action.costCurrency === 'GBP'
        ? '1'
        : settings[BILLING.fxPrefix + action.costCurrency];
    if (!fx) {
      throw new Error(`No exchange rate for ${action.costCurrency}`);
    }

    const multiplierBp =
      action.multiplierBp ??
      (await this.numberSetting(BILLING.defaultMultiplierBp));
    const creditsPerGbp = await this.numberSetting(BILLING.creditsPerGbp);

    // cost (millionths) x fx (millionths) x multiplier (bp) x credits/GBP x 100
    return Number(
      ceilDiv(
        BigInt(action.costMicros) *
          BigInt(toMicros(fx)) *
          BigInt(multiplierBp) *
          BigInt(creditsPerGbp) *
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

  async priceList(provider?: string): Promise<PricedAction[]> {
    const actions = (await this._wallet.actions()).filter(
      (a) => !provider || a.provider === provider
    );
    return Promise.all(
      actions.map(async (a) => ({
        key: a.key,
        provider: a.provider,
        name: a.name,
        description: a.description,
        unit: a.unit,
        price: await this.priceOf(a),
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

  // Whether the wallet prices this provider at all (it has active actions).
  async billsProvider(identifier: string) {
    const provider = providerOf(identifier);
    return (await this._wallet.actions()).some((a) => a.provider === provider);
  }

  // A provider the free plan locks is open to a pay-as-you-go workspace when
  // the wallet prices it.
  async unlocksProvider(organizationId: string, identifier: string) {
    return (
      (await this.billsProvider(identifier)) &&
      (await this.isPayAsYouGo(organizationId))
    );
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
  }) {
    const priced = await this.price(params.actionKey);
    if (!priced) {
      throw new Error(`No price for ${params.actionKey}`);
    }
    const quantity = params.quantity ?? 1;
    return this._wallet.spend({
      organizationId: params.organizationId,
      amount: priced.price * quantity,
      type: 'spend',
      actionKey: params.actionKey,
      quantity,
      unitPrice: priced.price,
      description: params.description || priced.action.name,
      chargeKey: params.chargeKey,
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
      type: 'refund',
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
    pence: number;
    auto: boolean;
    paymentIntentId: string;
  }) {
    const units = await this.unitsForPence(params.pence);
    const entry = await this._wallet.add({
      organizationId: params.organizationId,
      amount: units,
      type: params.auto ? 'auto_topup' : 'topup',
      description: params.auto ? 'Auto top-up' : 'Top-up',
      amountPence: params.pence,
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

  autoTopUpPenceSince(organizationId: string, since: Date) {
    return this._wallet.autoTopUpPenceSince(organizationId, since);
  }
}
