import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { WalletPublicService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.public.service';
import { WalletEstimateDto } from '@gitroom/nestjs-libraries/dtos/wallet/wallet.dto';

// The credit wallet over the public API, read-only: the balance, the price
// list, the transactions, and what a post would cost. Topping up and the
// card stay in the app. Open to every plan; a paid plan is told it does not
// use credits.
@ApiTags('Public API')
@Controller('/public/v1')
export class PublicWalletController {
  constructor(private _walletPublic: WalletPublicService) {}

  @Get('/wallet')
  summary(@GetOrgFromRequest() org: Organization) {
    return this._walletPublic.summary(org);
  }

  @Get('/wallet/prices')
  prices(@Query('provider') provider?: string) {
    return this._walletPublic.prices(
      typeof provider === 'string' ? provider : undefined
    );
  }

  // `type` filters by entry type, comma separated (e.g. TOPUP,CHARGE).
  @Get('/wallet/transactions')
  transactions(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('type') type?: string
  ) {
    return this._walletPublic.transactions(
      org,
      Number(page) || 0,
      Number(size) || 20,
      typeof type === 'string' ? type : undefined
    );
  }

  @Post('/wallet/estimate')
  estimate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: WalletEstimateDto
  ) {
    return this._walletPublic.estimate(org, body);
  }
}
