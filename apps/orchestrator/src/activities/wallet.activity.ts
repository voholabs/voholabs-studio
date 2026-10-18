import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { WalletHousekeepingService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.housekeeping.service';
import { WalletPlusService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.plus.service';

// Wallet housekeeping activities.
@Injectable()
@Activity()
export class WalletActivity {
  constructor(
    private _housekeeping: WalletHousekeepingService,
    private _plus: WalletPlusService
  ) {}

  // Storage month pass, short-forecast notices and the daily
  // reconciliation. Idempotent: safe to retry and to run any time.
  @ActivityMethod()
  async walletHousekeeping() {
    return this._housekeeping.run();
  }

  // Milliseconds until the Plus early bird's extension starts, or null when
  // there is none to tell about.
  @ActivityMethod()
  async plusEarlyBirdEmailDelay(organizationId: string) {
    return this._plus.earlyBirdEmailDelay(organizationId);
  }

  // Sends the one early-bird extension email, when it still applies. Safe to
  // retry: it goes out once.
  @ActivityMethod()
  async sendPlusEarlyBirdEmail(organizationId: string) {
    return this._plus.sendEarlyBirdEmail(organizationId);
  }
}
