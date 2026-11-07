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
import { UserFlowsService } from '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.service';
import { FlowsService } from '@gitroom/nestjs-libraries/flows/flows.service';
import {
  ForkUserFlowDto,
  ImportUserFlowDto,
  SaveUserFlowDto,
} from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

// My flows: the workspace's own flows, their share links and imports. Opens
// with Plus (or a paid plan), like the flows library.
@ApiTags('Flows')
@Controller('/user-flows')
@CheckPolicies([AuthorizationActions.Create, Sections.FLOWS])
export class UserFlowsController {
  constructor(
    private _userFlows: UserFlowsService,
    private _flows: FlowsService
  ) {}

  @Get('/')
  async list(@GetOrgFromRequest() org: Organization) {
    return { flows: await this._userFlows.list(org.id) };
  }

  @Post('/')
  create(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveUserFlowDto
  ) {
    return this._userFlows.save(org.id, body, { source: 'CREATED' });
  }

  // A Voho library flow, copied into My flows.
  @Post('/fork')
  async fork(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ForkUserFlowDto
  ) {
    const source = await this._flows.source(body.id);
    if (!source) {
      throw new NotFoundException('That library flow could not be read');
    }
    return this._userFlows.fork(org.id, source, body.slug);
  }

  // A shared flow, copied into My flows with the author's brand scrubbed.
  @Post('/import')
  import(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ImportUserFlowDto
  ) {
    return this._userFlows.import(org.id, body.token, body.slug);
  }

  @Get('/:slug')
  async get(@GetOrgFromRequest() org: Organization, @Param('slug') slug: string) {
    const flow = await this._userFlows.get(org.id, slug);
    if (!flow) {
      throw new NotFoundException('Flow not found');
    }
    return flow;
  }

  @Patch('/:slug')
  update(
    @GetOrgFromRequest() org: Organization,
    @Param('slug') slug: string,
    @Body() body: SaveUserFlowDto
  ) {
    return this._userFlows.update(org.id, slug, body);
  }

  @Delete('/:slug')
  delete(@GetOrgFromRequest() org: Organization, @Param('slug') slug: string) {
    return this._userFlows.delete(org.id, slug);
  }

  @Post('/:slug/share')
  share(@GetOrgFromRequest() org: Organization, @Param('slug') slug: string) {
    return this._userFlows.share(org.id, slug);
  }

  @Delete('/:slug/share')
  revoke(@GetOrgFromRequest() org: Organization, @Param('slug') slug: string) {
    return this._userFlows.revoke(org.id, slug);
  }
}

// The page a share link opens. Signed in only (behind the login), and open to
// every plan, so whoever was sent a flow can see what it does before Plus
// lets them import it. It holds the method, scrubbed, never the author's
// workspace.
@ApiTags('Flows')
@Controller('/user-flows/shared')
export class SharedUserFlowsController {
  constructor(private _userFlows: UserFlowsService) {}

  @Get('/:token')
  shared(@Param('token') token: string) {
    return this._userFlows.shared(token);
  }
}
