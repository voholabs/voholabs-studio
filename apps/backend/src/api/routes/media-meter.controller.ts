import { Controller, Get } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { MediaMeterService } from '@gitroom/nestjs-libraries/database/prisma/media-meter/media-meter.service';

@ApiTags('Media Meter')
@Controller('/media-meter')
export class MediaMeterController {
  constructor(private _mediaMeterService: MediaMeterService) {}

  // Read-only usage for the calling organization. Never errors for a missing
  // setup or a dead meter — the service folds those into the returned state.
  @Get('/usage')
  async usage(@GetOrgFromRequest() org: Organization) {
    return this._mediaMeterService.getUsage(org.id);
  }
}
