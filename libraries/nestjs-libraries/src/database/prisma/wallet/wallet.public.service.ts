import { Injectable } from '@nestjs/common';
import { WalletEntryType } from '@prisma/client';
import dayjs from 'dayjs';
import {
  receiptUrlOf,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { hasAccess } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import {
  freeAllowance,
  monthlyRules,
  notOnWalletMessage,
  priceText,
  pricingModel,
  sectionLabel,
  toCredits,
  topUpUrl,
} from '@gitroom/nestjs-libraries/chat/tools/wallet.shared';

const ENTRY_TYPES = Object.values(WalletEntryType) as string[];

// "TOPUP,AUTO_TOPUP" -> the entry types to list; unknown names are ignored.
export const walletEntryTypes = (value?: string) =>
  (value || '')
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter((v) => ENTRY_TYPES.includes(v)) as WalletEntryType[];

// The wallet as the public API reads it: read-only, every amount in credits
// (2 decimals) rather than the hundredths the ledger stores. A paid plan
// never uses credits and is told so instead.
@Injectable()
export class WalletPublicService {
  constructor(private _wallet: WalletService) {}

  private notOnWallet(org: any) {
    return hasAccess(org)
      ? { usesWallet: false as const, message: notOnWalletMessage }
      : undefined;
  }

  async summary(org: any) {
    const paid = this.notOnWallet(org);
    if (paid) {
      return paid;
    }
    const [wallet, balance, payAsYouGo, forecast, spentAuto, currency, rules] =
      await Promise.all([
        this._wallet.getWallet(org.id),
        this._wallet.balance(org.id),
        this._wallet.isPayAsYouGo(org.id),
        this._wallet.forecast(org.id).catch((): undefined => undefined),
        this._wallet.autoTopUpSpentSince(
          org.id,
          dayjs().startOf('month').toDate()
        ),
        this._wallet.currency().catch((): null => null),
        this._wallet.topUpRules().catch((): undefined => undefined),
      ]);
    const frozen = !!wallet?.frozenAt;
    return {
      usesWallet: true as const,
      balance: toCredits(balance),
      payAsYouGo: payAsYouGo && !frozen,
      frozen,
      currency: wallet?.currency || currency,
      creditsPerUnit: rules?.creditsPerUnit ?? null,
      autoTopUp: {
        enabled: !!wallet?.autoTopUp,
        belowCredits:
          wallet?.autoTopUpThreshold === null ||
          wallet?.autoTopUpThreshold === undefined
            ? null
            : toCredits(wallet.autoTopUpThreshold),
        // Amounts of money are in the smallest unit of the currency.
        amount: wallet?.autoTopUpAmount ?? null,
        monthlyLimit: wallet?.autoTopUpMonthlyCap ?? null,
        usedThisMonth: spentAuto || 0,
      },
      forecast: forecast
        ? {
            windowHours: forecast.windowHours,
            neededCredits: toCredits(forecast.needed),
            short: forecast.short,
          }
        : null,
      topUpUrl: topUpUrl(),
    };
  }

  async prices(provider?: string) {
    const sections = await this._wallet.priceSections(
      provider?.toLowerCase() || undefined
    );
    return {
      sections: sections.map((section) => ({
        key: section.key,
        label: sectionLabel(section.key),
        items: section.actions.map((a) => ({
          key: a.key,
          name: a.name,
          description: a.description,
          provider: a.provider,
          unit: a.unit,
          billing: a.billing,
          requiresTopUp: a.requiresTopUp,
          pricingModel: pricingModel(a),
          includedFree: freeAllowance(a),
          price: priceText(a),
          credits: toCredits(a.price),
          ...(a.billing === 'MONTHLY' ? { howCharged: monthlyRules(a) } : {}),
        })),
      })),
      topUpUrl: topUpUrl(),
    };
  }

  async transactions(org: any, page = 0, size = 20, type?: string) {
    const paid = this.notOnWallet(org);
    if (paid) {
      return { ...paid, total: 0, items: [] as any[] };
    }
    const safePage = Math.max(0, Math.floor(page) || 0);
    const safeSize = Math.min(Math.max(1, Math.floor(size) || 20), 100);
    const [items, total] = await this._wallet.entries(
      org.id,
      safePage,
      safeSize,
      walletEntryTypes(type)
    );
    return {
      total,
      page: safePage,
      size: safeSize,
      nextPage: (safePage + 1) * safeSize < total ? safePage + 1 : null,
      items: items.map((e) => ({
        id: e.id,
        type: e.type,
        description: e.description,
        credits: toCredits(e.amount),
        quantity: e.quantity,
        actionKey: e.actionKey,
        reference: e.reference,
        receiptUrl: receiptUrlOf(e),
        createdAt: new Date(e.createdAt).toISOString(),
      })),
    };
  }

  // A post and its replies on one channel, priced with the rule that charges
  // them when they are scheduled. Nothing is charged by asking.
  async estimate(
    org: any,
    body: { provider: string; contents: string[]; group?: string; inter?: number }
  ) {
    const paid = this.notOnWallet(org);
    if (paid) {
      return paid;
    }
    const estimate = await this._wallet.estimateContents(
      org.id,
      body.provider,
      body.contents,
      { group: body.group, inter: body.inter }
    );
    return {
      usesWallet: true as const,
      charged: estimate.items.length > 0,
      priceCredits: toCredits(estimate.price),
      alreadyPaidCredits: toCredits(estimate.alreadyPaid),
      dueCredits: toCredits(estimate.due),
      balanceAfterCredits: toCredits(estimate.balanceAfter),
      short: estimate.short,
      autoTopUpCovers: estimate.autoCovers,
      perOccurrence: !!estimate.perOccurrence,
      items: estimate.items.map((item) => ({
        actionKey: item.actionKey,
        credits: toCredits(item.price),
      })),
      ...(estimate.short ? { topUpUrl: topUpUrl() } : {}),
    };
  }
}
