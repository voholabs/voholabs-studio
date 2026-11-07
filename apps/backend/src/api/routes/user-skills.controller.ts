import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { UserSkillsService } from '@gitroom/nestjs-libraries/database/prisma/user-skills/user-skills.service';
import { SaveUserSkillDto } from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

// My skills: the workspace's own skills, which its flows bring in with a
// skill link to "my/<slug>". They come with My flows, so they open with Plus
// (or a paid plan) like the flows, not with the skills library.
@ApiTags('Flows')
@Controller('/user-skills')
@CheckPolicies([AuthorizationActions.Create, Sections.FLOWS])
export class UserSkillsController {
  constructor(private _userSkills: UserSkillsService) {}

  @Get('/')
  async list(@GetOrgFromRequest() org: Organization) {
    return { skills: await this._userSkills.list(org.id) };
  }

  @Post('/')
  create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveUserSkillDto
  ) {
    return this._userSkills.create(org.id, body);
  }

  @Get('/:slug')
  async get(@GetOrgFromRequest() org: Organization, @Param('slug') slug: string) {
    const skill = await this._userSkills.get(org.id, slug);
    if (!skill) {
      throw new NotFoundException('Skill not found');
    }
    return skill;
  }

  @Patch('/:slug')
  update(
    @GetOrgFromRequest() org: Organization,
    @Param('slug') slug: string,
    @Body() body: SaveUserSkillDto
  ) {
    return this._userSkills.update(org.id, slug, body);
  }

  @Delete('/:slug')
  delete(@GetOrgFromRequest() org: Organization, @Param('slug') slug: string) {
    return this._userSkills.delete(org.id, slug);
  }
}
