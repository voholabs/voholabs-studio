import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';
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
import { BRAIN_REGISTRY } from '@gitroom/nestjs-libraries/agent-brain/brain.registry';

// The agent brain over the public API, so the CLI and any external agent can
// read and edit it with an API key. Gated on the AI capability, which the free
// tier does not carry.
@ApiTags('Public API')
@Controller('/public/v1')
@CheckPolicies([AuthorizationActions.Create, Sections.AI])
export class PublicBrainController {
  constructor(private _brainService: BrainService) {}

  // The shape of the brain: which categories and documents exist, so a caller
  // knows what keys it may write to without guessing.
  @Get('/brain/schema')
  schema() {
    return {
      categories: BRAIN_REGISTRY.map((category) => ({
        id: category.id,
        label: category.label,
        source: category.source,
        canCreate: !!category.canCreate,
        canDelete: !!category.canDelete,
        documents: (category.documents || []).map((document) => ({
          key: document.key,
          label: document.label,
          description: document.description,
        })),
        ...(category.documentTemplate
          ? {
              documentTemplate: {
                label: category.documentTemplate.label,
                description: category.documentTemplate.description,
                features: category.documentTemplate.features || [],
              },
            }
          : {}),
      })),
    };
  }

  @Get('/brain')
  getDocuments(@GetOrgFromRequest() org: Organization) {
    return this._brainService.getDocuments(org.id);
  }

  @Get('/brain/:category/:key')
  async getDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Param('key') key: string
  ) {
    const { documents } = await this._brainService.getDocuments(org.id);
    const document = documents.find(
      (one) => one.category === category && one.key === key
    );

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  @Patch('/brain/:category/:key')
  saveDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Param('key') key: string,
    @Body() body: SaveBrainDocumentDto
  ) {
    return this._brainService.saveDocument(org.id, category, key, body);
  }

  @Delete('/brain/:category/:key')
  deleteDocument(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Param('key') key: string
  ) {
    return this._brainService.deleteDocument(org.id, category, key);
  }
}
