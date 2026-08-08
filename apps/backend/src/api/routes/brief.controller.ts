import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { BriefService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.service';
import { SaveBriefDocumentDto } from '@gitroom/nestjs-libraries/dtos/brief/brief.dto';

@ApiTags('Brief')
@Controller('/brief')
@CheckPolicies([AuthorizationActions.Create, Sections.AI])
export class BriefController {
  constructor(private _briefService: BriefService) {}

  @Get('/')
  getDocuments(@GetOrgFromRequest() org: Organization) {
    return this._briefService.getDocuments(org.id);
  }

  @Patch('/:category/:key')
  saveDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Param('key') key: string,
    @Body() body: SaveBriefDocumentDto
  ) {
    return this._briefService.saveDocument(org.id, category, key, body);
  }

  @Delete('/:category/:key')
  deleteDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Param('key') key: string
  ) {
    return this._briefService.deleteDocument(org.id, category, key);
  }
}
