import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  AuthLimits,
  AuthRateLimit,
  AuthRateLimitGuard,
} from '@gitroom/nestjs-libraries/throttler/auth.rate.limit.guard';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { DeviceAuthService } from '@gitroom/nestjs-libraries/database/prisma/device/device.auth.service';

// Public endpoints hit by the CLI (no auth — the CLI has no token yet).
// Registered OUTSIDE `authenticatedController` in api.module.ts.
@ApiTags('Device')
@Controller('/device')
export class DeviceController {
  constructor(private _deviceAuthService: DeviceAuthService) {}

  @Post('/code')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(...AuthLimits.deviceCode)
  async code() {
    return this._deviceAuthService.createDeviceCode();
  }

  @Post('/token')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(...AuthLimits.deviceToken)
  async token(@Body() body: { device_code: string }) {
    return this._deviceAuthService.poll(body?.device_code);
  }
}

// Authenticated endpoints hit by the browser approval page. Same base path as
// the public controller but distinct sub-paths; registered INSIDE
// `authenticatedController` so AuthMiddleware runs (mirrors the OAuthController /
// OAuthAuthorizedController split).
@ApiTags('Device')
@Controller('/device')
export class DeviceAuthorizedController {
  constructor(private _deviceAuthService: DeviceAuthService) {}

  @Get('/info')
  async info(@Query('user_code') userCode: string) {
    return this._deviceAuthService.getByUserCode(userCode);
  }

  @Post('/approve')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(...AuthLimits.deviceApprove)
  async approve(
    @Body() body: { user_code: string },
    @GetOrgFromRequest() org: Organization
  ) {
    return this._deviceAuthService.approve(body?.user_code, org);
  }
}
