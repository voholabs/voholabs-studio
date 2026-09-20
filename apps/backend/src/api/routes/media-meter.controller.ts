import { Controller, Get } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { MediaMeterService } from '@gitroom/nestjs-libraries/database/prisma/media-meter/media-meter.service';
import {
  AccessOrganization,
  hasAccess,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';

@ApiTags('Media Meter')
@Controller('/media-meter')
export class MediaMeterController {
  constructor(private _mediaMeterService: MediaMeterService) {}

  // Read-only usage for the calling organization. Never errors for a missing
  // setup or a dead meter — the service folds those into the returned state.
  @Get('/usage')
  async usage(@GetOrgFromRequest() org: Organization) {
    // Reading usage mints the organization's metered key on first view, and
    // the free plan has no AI media, so it reads as not set up instead.
    // The middleware loads the organization with its subscription, which the
    // bare Prisma type does not carry.
    if (!hasAccess(org as AccessOrganization)) {
      return { state: 'not_configured' };
    }

    return this._mediaMeterService.getUsage(org.id);
  }
}
