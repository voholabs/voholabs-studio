import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotifyTeamDto } from '@gitroom/nestjs-libraries/dtos/notifications/notify.team.dto';

// Lets the CLI, and any agent holding an API key, email the people on the team.
// It cannot reach anyone else: the recipient list comes from the organization,
// never from the request. See NotificationService.notifyTeam.
@ApiTags('Public API')
@Controller('/public/v1')
@CheckPolicies([AuthorizationActions.Create, Sections.AI])
export class PublicNotifyController {
  constructor(
    private _notificationService: NotificationService,
    private _organizationRepository: OrganizationRepository
  ) {}

  // Who is on the team, so a caller can address part of it without guessing at
  // addresses. Emails only — names and roles are not the caller's business.
  @Get('/team')
  async team(@GetOrgFromRequest() org: Organization) {
    const organization = await this._organizationRepository.getAllUsersOrgs(
      org.id
    );

    return {
      members: (organization?.users || []).map((one) => ({
        email: one.user.email,
      })),
      emailProvider: this._notificationService.hasEmailProvider(),
    };
  }

  @Post('/notify')
  notify(
    @GetOrgFromRequest() org: Organization,
    @Body() body: NotifyTeamDto
  ) {
    return this._notificationService.notifyTeam(
      org.id,
      body.subject,
      body.message,
      body.to
    );
  }
}
