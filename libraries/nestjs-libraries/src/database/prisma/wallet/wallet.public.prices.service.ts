import { Injectable } from '@nestjs/common';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  ResearchPrice,
  WalletResearchPricesService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.research.prices.service';
import {
  PlusOffer,
  WalletPlusService,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service';

// How long one public price list is served before it is read again.
export const PUBLIC_PRICES_TTL_MS = 60_000;

export interface PublicPrices {
  currency: string | null;
  // Credits for one unit of the currency (e.g. 100 for $1).
  creditsPerUnit: number | null;
  // The default markup on provider cost, in basis points (15000 = x1.5).
  defaultMultiplierBp: number | null;
  // Smallest currency unit.
  topUp: { minAmount: number; options: number[] } | null;
  sections: Awaited<ReturnType<WalletService['priceSections']>>;
  // Every channel provider, by id and display name.
  channels: { identifier: string; name: string }[];
  // What each kind of research data typically costs per run.
  research: ResearchPrice[];
  // Plus, or null when it is not offered.
  plus: PlusOffer | null;
}

// The price list for visitors who are not signed in: the same rows as the
// in-app Prices page plus the top-up rules, and nothing about any workspace.
@Injectable()
export class WalletPublicPricesService {
  private _cache?: { at: number; value: Promise<PublicPrices> };

  constructor(
    private _wallet: WalletService,
    private _integrations: IntegrationManager,
    private _research: WalletResearchPricesService,
    private _plus: WalletPlusService
  ) {}

  prices(): Promise<PublicPrices> {
    if (!this._cache || Date.now() - this._cache.at > PUBLIC_PRICES_TTL_MS) {
      const value = this.load();
      this._cache = { at: Date.now(), value };
      // A failed read is not kept: the next request tries again.
      value.catch(() => {
        if (this._cache?.value === value) this._cache = undefined;
      });
    }
    return this._cache.value;
  }

  private async load(): Promise<PublicPrices> {
    const [sections, rules, currency, research, rates, plus] = await Promise.all([
      this._wallet.priceSections(),
      this._wallet.topUpRules().catch(() => null),
      this._wallet.currency().catch(() => null),
      this._research
        .prices()
        .then((r) => r.groups)
        .catch((): ResearchPrice[] => []),
      this._wallet.rates().catch(() => null),
      this._plus.offer(),
    ]);
    return {
      currency,
      creditsPerUnit: rules?.creditsPerUnit ?? null,
      defaultMultiplierBp: rates?.defaultMultiplierBp ?? null,
      topUp: rules
        ? { minAmount: rules.minAmount, options: rules.options }
        : null,
      sections,
      channels: this._integrations.socialProviders(),
      research,
      plus,
    };
  }
}
