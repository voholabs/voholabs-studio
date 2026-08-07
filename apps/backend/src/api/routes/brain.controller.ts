import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { BrainService } from '@gitroom/nestjs-libraries/database/prisma/brain/brain.service';
import { SaveBrainDocumentDto } from '@gitroom/nestjs-libraries/dtos/brain/brain.dto';

@ApiTags('Brain')
@Controller('/brain')
@CheckPolicies([AuthorizationActions.Create, Sections.AI])
export class BrainController {
  constructor(private _brainService: BrainService) {}

  @Get('/')
  getDocuments(@GetOrgFromRequest() org: Organization) {
    return this._brainService.getDocuments(org.id);
  }

  @Patch('/:category/:key')
  saveDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Param('key') key: string,
    @Body() body: SaveBrainDocumentDto
  ) {
    return this._brainService.saveDocument(org.id, category, key, body);
  }

  @Delete('/:category/:key')
  deleteDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Param('key') key: string
  ) {
    return this._brainService.deleteDocument(org.id, category, key);
  }
}
