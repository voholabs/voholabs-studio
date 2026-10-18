import { Injectable } from '@nestjs/common';
import {
  AdminStatsRepository,
  GrowthMoney,
  GrowthResponse,
  OrgActivityParams,
  StatsParams,
} from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import {
  PLUS,
  WalletService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { WalletPlusService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service';

@Injectable()
export class AdminStatsService {
  constructor(
    private _adminStatsRepository: AdminStatsRepository,
    private _walletService: WalletService,
    private _walletPlusService: WalletPlusService
  ) {}

  getStats(params: StatsParams) {
    return this._adminStatsRepository.getStats(params);
  }

  async getGrowth(): Promise<GrowthResponse> {
    const [growth, money] = await Promise.all([
      this._adminStatsRepository.getGrowth(),
      this.growthMoney(),
    ]);
    return { ...growth, money };
  }

  // The money numbers, with the active Plus subscriptions priced: what Stripe
  // bills each one (a comped one, all discounted, is left out of MRR), or the
  // price settings for any Stripe could not return.
  private async growthMoney(): Promise<GrowthMoney> {
    const rows = await this._adminStatsRepository.getGrowthMoney(
      await this._walletService.plusLaunchAt()
    );
    const { subscriptions, ...plus } = rows.plus;
    const [prices, settings, currency, actions] = await Promise.all([
      this._walletPlusService.subscriptionPrices(
        subscriptions.map((s) => s.subscriptionId)
      ),
      this._walletService.settings(),
      // Unset on an instance without wallet billing: no settings prices then.
      this._walletService.currency().catch((): string | null => null),
      this._walletService.actions(),
    ]);

    const mrr = new Map<string, number>();
    let comped = 0;
    let fromSettings = false;
    for (const subscription of subscriptions) {
      const stripe = prices.get(subscription.subscriptionId);
      if (stripe?.comped) {
        comped++;
        continue;
      }
      const interval = stripe?.interval || subscription.interval;
      const amount =
        stripe?.amount ??
        Number(
          settings[interval === 'year' ? PLUS.annualPrice : PLUS.monthlyPrice]
        );
      if (!stripe) {
        fromSettings = true;
      }
      const key = stripe?.currency || currency;
      if (!key || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }
      mrr.set(
        key,
        (mrr.get(key) || 0) + (interval === 'year' ? amount / 12 : amount)
      );
    }

    const names = new Map(actions.map((a) => [a.key, a.name]));
    return {
      ...rows,
      plus: {
        ...plus,
        comped,
        mrr: Array.from(mrr, ([key, amount]) => ({
          currency: key,
          amount: Math.round(amount),
        })),
        mrrSource: fromSettings ? 'settings' : 'stripe',
      },
      topActions: rows.topActions.map((action) => ({
        ...action,
        name: names.get(action.actionKey) || action.actionKey,
      })),
    };
  }

  getOrgActivity(params: OrgActivityParams) {
    return this._adminStatsRepository.getOrgActivity(params);
  }
}
