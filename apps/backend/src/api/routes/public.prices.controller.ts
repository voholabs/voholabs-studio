import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WalletPublicPricesService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.public.prices.service';

// The price list for the public /pricing page. No login: it holds only the
// price rows and the top-up rules, and is cached for a minute.
@ApiTags('Public')
@Controller('/public/prices')
export class PublicPricesController {
  constructor(private _prices: WalletPublicPricesService) {}

  @Get('/')
  @Header('Cache-Control', 'public, max-age=60')
  prices() {
    return this._prices.prices();
  }
}
