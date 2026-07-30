import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { WhitelistDto } from '@gitroom/nestjs-libraries/dtos/admin/whitelist.dto';
import dayjs from 'dayjs';

@ApiTags('Admin')
@Controller('/admin')
export class AdminController {
  constructor(
    private _errorsService: ErrorsService,
    private _adminStatsService: AdminStatsService,
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _userService: UsersService
  ) {}

  private assertSuperAdmin(user: User) {
    if (!user?.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }
  }

  // Whitelist an organization = give it the Subscription row a paying customer
  // has. `days` empty means forever, a number gives access for that many days,
  // `remove` expires it. `allExisting` is the one off backfill that keeps every
  // organization created before the free trial shipped unlimited.
  @Post('/whitelist')
  async whitelist(
    @GetUserFromRequest() user: User,
    @Body() body: WhitelistDto
  ) {
    this.assertSuperAdmin(user);

    if (body.allExisting) {
      const organizations =
        await this._subscriptionService.getAllOrganizationIds();

      for (const organization of organizations) {
        await this._subscriptionService.whitelistOrganization(
          organization.id,
          null
        );
      }

      return { whitelisted: organizations.length };
    }

    const orgId = await this.resolveOrganization(body.org, body.email);
    if (!orgId) {
      throw new HttpException('Organization not found', 400);
    }

    if (body.remove) {
      await this._subscriptionService.removeWhitelistFromOrganization(orgId);
      return { orgId, access: false };
    }

    await this._subscriptionService.whitelistOrganization(
      orgId,
      body.days || null
    );

    return { orgId, access: true, days: body.days || null };
  }

  private async resolveOrganization(org?: string, email?: string) {
    if (org) {
      return (await this._organizationService.getOrgById(org))?.id;
    }

    if (!email) {
      return undefined;
    }

    const user = await this._userService.getUserByEmail(email);
    if (!user) {
      return undefined;
    }

    return (await this._organizationService.getOrgsByUserId(user.id))?.[0]?.id;
  }

  @Get('/errors')
  async listErrors(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: string,
    @Query('email') email?: string,
    @Query('unknownFirst') unknownFirst?: string
  ) {
    this.assertSuperAdmin(user);
    return this._errorsService.listErrors({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      platform: platform || undefined,
      email: email || undefined,
      unknownFirst: unknownFirst === 'true' || unknownFirst === '1',
    });
  }

  @Get('/errors/platforms')
  async listPlatforms(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._errorsService.listPlatforms();
  }

  @Get('/stats')
  async getStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unknownOnly') unknownOnly?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = from ? dayjs(from) : dayjs().subtract(30, 'day');
    const toDate = to ? dayjs(to) : dayjs();

    return this._adminStatsService.getStats({
      from: fromDate.startOf('day').toDate(),
      to: toDate.endOf('day').toDate(),
      unknownOnly: unknownOnly === 'true' || unknownOnly === '1',
    });
  }
}
