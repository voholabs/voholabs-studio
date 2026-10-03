import {
  Body,
  Controller,
  Get,
  HttpException,
  Patch,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import dayjs from 'dayjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { WalletService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.service';
import {
  WalletBillingService,
  walletPaymentsEnabled,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.billing.service';
import {
  WalletAutoTopUpDto,
  WalletCheckoutDto,
} from '@gitroom/nestjs-libraries/dtos/wallet/wallet.dto';

type OrgWithRole = Organization & { users?: { role?: string }[] };

// Only an organization's admins move money.
const assertAdmin = (org: OrgWithRole) => {
  const role = org.users?.[0]?.role;
  if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
    throw new HttpException('Only an admin of this workspace can do this', 403);
  }
};

@ApiTags('Wallet')
@Controller('/wallet')
export class WalletController {
  constructor(
    private _wallet: WalletService,
    private _billing: WalletBillingService
  ) {}

  @Get('/')
  async summary(@GetOrgFromRequest() org: Organization) {
    const [wallet, balance, rules, spentAuto] = await Promise.all([
      this._wallet.getWallet(org.id),
      this._wallet.balance(org.id),
      this._wallet.topUpRules().catch(() => undefined),
      this._wallet.autoTopUpPenceSince(
        org.id,
        dayjs().startOf('month').toDate()
      ),
    ]);
    return {
      balance,
      payAsYouGo: !!wallet?.firstTopUpAt,
      paymentsEnabled: walletPaymentsEnabled(),
      topUp: rules || null,
      card: wallet?.cardLast4
        ? { brand: wallet.cardBrand, last4: wallet.cardLast4 }
        : null,
      autoTopUp: {
        enabled: !!wallet?.autoTopUp,
        threshold: wallet?.autoTopUpThreshold ?? null,
        amountPence: wallet?.autoTopUpAmountPence ?? null,
        monthlyCapPence: wallet?.autoTopUpMonthlyCapPence ?? null,
        usedThisMonthPence: spentAuto,
      },
    };
  }

  @Get('/transactions')
  async transactions(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page = '0',
    @Query('size') size = '20'
  ) {
    const [items, total] = await this._wallet.entries(
      org.id,
      Math.max(0, Number(page) || 0),
      Math.max(1, Number(size) || 20)
    );
    return {
      total,
      items: items.map((e) => ({
        id: e.id,
        type: e.type,
        description: e.description,
        amount: e.amount,
        quantity: e.quantity,
        unitPrice: e.unitPrice,
        actionKey: e.actionKey,
        reference: e.reference,
        createdAt: e.createdAt,
      })),
    };
  }

  @Get('/usage')
  usage(@GetOrgFromRequest() org: Organization, @Query('days') days = '30') {
    const span = Math.min(Math.max(Number(days) || 30, 1), 366);
    return this._wallet.usage(
      org.id,
      dayjs().subtract(span, 'day').startOf('day').toDate()
    );
  }

  @Get('/prices')
  prices(@Query('provider') provider?: string) {
    return this._wallet.priceList(provider);
  }

  @Post('/checkout')
  async checkout(
    @GetOrgFromRequest() org: OrgWithRole,
    @GetUserFromRequest() user: User,
    @Body() body: WalletCheckoutDto
  ) {
    assertAdmin(org);
    if (!walletPaymentsEnabled()) {
      throw new HttpException('Top-ups are not available yet', 503);
    }
    try {
      return await this._billing.createCheckout({
        organizationId: org.id,
        email: user.email,
        name: org.name,
        pence: body.pence,
        saveCard: !!body.saveCard,
        returnUrl: `${process.env.FRONTEND_URL}/wallet`,
      });
    } catch (err) {
      throw new HttpException((err as Error).message, 400);
    }
  }

  @Patch('/auto-top-up')
  async autoTopUp(
    @GetOrgFromRequest() org: OrgWithRole,
    @Body() body: WalletAutoTopUpDto
  ) {
    assertAdmin(org);
    const wallet = await this._wallet.ensureWallet(org.id);
    if (body.enabled) {
      const rules = await this._wallet.topUpRules();
      if (!wallet.paymentMethodId) {
        throw new HttpException('Save a card with a top-up first', 400);
      }
      if (!body.amountPence || body.amountPence < rules.minPence) {
        throw new HttpException(
          `The minimum top-up is £${(rules.minPence / 100).toFixed(2)}`,
          400
        );
      }
      if (!body.monthlyCapPence || body.monthlyCapPence < body.amountPence) {
        throw new HttpException(
          'Set a monthly limit of at least one top-up',
          400
        );
      }
    }
    await this._wallet.updateWallet(org.id, {
      autoTopUp: body.enabled,
      autoTopUpThreshold: body.threshold ?? wallet.autoTopUpThreshold,
      autoTopUpAmountPence: body.amountPence ?? wallet.autoTopUpAmountPence,
      autoTopUpMonthlyCapPence:
        body.monthlyCapPence ?? wallet.autoTopUpMonthlyCapPence,
    });
    return this.summary(org);
  }
}

// Stripe calls this, so it sits outside the signed-in routes. The signature
// check is the authentication.
@ApiTags('Wallet')
@Controller('/wallet-webhook')
export class WalletWebhookController {
  constructor(private _billing: WalletBillingService) {}

  @Post('/')
  async webhook(@Req() req: RawBodyRequest<Request>) {
    let event;
    try {
      event = this._billing.validateWebhook(
        req.rawBody!,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        req.headers['stripe-signature']
      );
    } catch {
      throw new HttpException('Invalid signature', 400);
    }
    return this._billing.handleEvent(event);
  }
}
