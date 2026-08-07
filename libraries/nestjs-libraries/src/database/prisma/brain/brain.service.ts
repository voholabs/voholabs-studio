import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrainRepository } from '@gitroom/nestjs-libraries/database/prisma/brain/brain.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { SaveBrainDocumentDto } from '@gitroom/nestjs-libraries/dtos/brain/brain.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  BRAIN_REGISTRY_VERSION,
  isAgentManaged,
  BRAIN_ASSETS_MAX,
  BRAIN_USER_DOCUMENTS_MAX,
  channelDocumentKey,
  documentHasFeature,
  emptyContent,
  findCategory,
  resolveDocumentDef,
} from '@gitroom/nestjs-libraries/agent-brain/brain.registry';
import {
  BrainDocument,
  BrainDocumentContent,
} from '@gitroom/nestjs-libraries/agent-brain/brain.types';

@Injectable()
export class BrainService {
  constructor(
    private _brainRepository: BrainRepository,
    private _integrationService: IntegrationService
  ) {}

  async getDocuments(orgId: string) {
    const [rows, channelKeys] = await Promise.all([
      this._brainRepository.getDocuments(orgId),
      this.channelKeysToIds(orgId),
    ]);

    const documents = rows.reduce((all, row) => {
      const category = findCategory(row.category);
      if (!category) {
        return all;
      }

      // Channel documents are stored against the account, so they are mapped
      // back to the integration the frontend knows about. A document whose
      // channel is no longer connected is simply not listed.
      let key = row.key;
      if (category.source === 'integration') {
        const integrationId = channelKeys.get(row.key);
        if (!integrationId) {
          return all;
        }

        key = integrationId;
      }

      all.push({
        category: category.id,
        key,
        content: this.parseContent(row.content),
        updatedAt: row.updatedAt?.toISOString(),
      });

      return all;
    }, [] as BrainDocument[]);

    return { registryVersion: BRAIN_REGISTRY_VERSION, documents };
  }

  async saveDocument(
    orgId: string,
    category: string,
    key: string,
    body: SaveBrainDocumentDto
  ) {
    const definition = findCategory(category);
    const document = resolveDocumentDef(category, key);
    if (!definition || !document) {
      throw new NotFoundException('Document not found');
    }

    // Agent-kept categories are written through their own path, so a request
    // arriving here is a person trying to edit the agent's notes.
    if (definition.readOnly) {
      throw new BadRequestException('This section is maintained by the agent');
    }

    const storageKey = await this.toStorageKey(orgId, category, key);
    const existing = await this._brainRepository.getDocument(
      orgId,
      category,
      storageKey
    );

    if (!existing && definition.source === 'user') {
      await this.assertRoomForAnother(orgId, category);
    }

    const content = this.parseContent(existing?.content);

    // Ordered lists are replaced whole; anything the request leaves out keeps
    // whatever was already stored.
    if (body.blocks) {
      content.blocks = body.blocks;
    }

    if (body.links && documentHasFeature(document, 'links')) {
      content.links = body.links;
    }

    if (body.assets && documentHasFeature(document, 'assets')) {
      content.assets = body.assets;
    }

    if (body.title !== undefined && definition.source === 'user') {
      content.title = body.title;
    }

    const saved = await this._brainRepository.saveDocument(
      orgId,
      category,
      storageKey,
      JSON.stringify(content)
    );

    return {
      category,
      key,
      content,
      updatedAt: saved.updatedAt?.toISOString(),
    };
  }

  async deleteDocument(
    orgId: string,
    category: string,
    key: string,
    viaAgent = false
  ) {
    const definition = findCategory(category);
    if (!definition || !resolveDocumentDef(category, key)) {
      throw new NotFoundException('Document not found');
    }

    // Only documents the user created are theirs to throw away; the rest are
    // part of the registry and are emptied rather than removed. An agent-kept
    // category is the agent's own, so it may retire a note it no longer stands
    // behind, but a person still cannot reach in and edit its notebook.
    const allowed = definition.agentManaged
      ? viaAgent
      : !!definition.canDelete;

    if (!allowed) {
      throw new BadRequestException(
        definition.agentManaged
          ? 'This section is maintained by the agent'
          : 'This document cannot be deleted'
      );
    }

    const storageKey = await this.toStorageKey(orgId, category, key);
    await this._brainRepository.deleteDocument(orgId, category, storageKey);

    return { deleted: true };
  }

  // Adds or refines a single rule without touching the rest of the document.
  // This is what lets the agent keep its own notes up to date incrementally
  // rather than rewriting a whole document each time it learns something.
  async recordExperience(
    orgId: string,
    key: string,
    rule: { heading: string; body: string },
    title?: string
  ) {
    const category = 'experience';
    if (!isAgentManaged(category)) {
      throw new BadRequestException('This category is not agent managed');
    }

    const existing = await this._brainRepository.getDocument(
      orgId,
      category,
      key
    );

    if (!existing) {
      await this.assertRoomForAnother(orgId, category);
    }

    const content = this.parseContent(existing?.content);

    // Same heading means the agent is revising what it already knew, not
    // adding a duplicate.
    const at = content.blocks.findIndex(
      (block) =>
        block.heading.trim().toLowerCase() === rule.heading.trim().toLowerCase()
    );

    if (at === -1) {
      content.blocks.push({
        id: makeId(10),
        heading: rule.heading,
        body: rule.body,
      });
    } else {
      content.blocks[at] = { ...content.blocks[at], body: rule.body };
    }

    if (title !== undefined) {
      content.title = title;
    }

    const saved = await this._brainRepository.saveDocument(
      orgId,
      category,
      key,
      JSON.stringify(content)
    );

    return {
      category,
      key,
      rules: content.blocks.length,
      revised: at !== -1,
      updatedAt: saved.updatedAt?.toISOString(),
    };
  }

  // Appends one file to Branding & assets without disturbing the rules or the
  // files already there.
  async registerAsset(
    orgId: string,
    asset: { name: string; url: string; mime?: string; note?: string }
  ) {
    const category = 'foundation';
    const key = 'branding-assets';
    const document = resolveDocumentDef(category, key);

    if (!document || !documentHasFeature(document, 'assets')) {
      throw new BadRequestException('This document does not hold files');
    }

    const existing = await this._brainRepository.getDocument(
      orgId,
      category,
      key
    );

    const content = this.parseContent(existing?.content);
    const assets = content.assets || [];

    if (assets.length >= BRAIN_ASSETS_MAX) {
      throw new BadRequestException('Too many files in this document');
    }

    content.assets = [
      ...assets,
      {
        id: makeId(10),
        name: asset.name,
        url: asset.url,
        ...(asset.mime ? { mime: asset.mime } : {}),
        ...(asset.note ? { note: asset.note } : {}),
      },
    ];

    await this._brainRepository.saveDocument(
      orgId,
      category,
      key,
      JSON.stringify(content)
    );

    return { assets: content.assets.length };
  }

  // Everything the agent knows about the business, as one structure. Nothing
  // consumes this yet.
  async getBrain(orgId: string) {
    const { documents } = await this.getDocuments(orgId);
    return documents;
  }

  private parseContent(raw?: string): BrainDocumentContent {
    try {
      const parsed = JSON.parse(raw || '{}');
      return {
        v: 1,
        blocks: Array.isArray(parsed?.blocks) ? parsed.blocks : [],
        ...(parsed?.links ? { links: parsed.links } : {}),
        ...(parsed?.assets ? { assets: parsed.assets } : {}),
        ...(parsed?.title ? { title: parsed.title } : {}),
      };
    } catch (err) {
      return emptyContent();
    }
  }

  private async assertRoomForAnother(orgId: string, category: string) {
    const existing = await this._brainRepository.countDocuments(
      orgId,
      category
    );

    if (existing >= BRAIN_USER_DOCUMENTS_MAX) {
      throw new BadRequestException('Too many documents in this section');
    }
  }

  // For integration categories the key that arrives from the frontend is an
  // integration id, and what gets stored identifies the account itself.
  private async toStorageKey(orgId: string, category: string, key: string) {
    const definition = findCategory(category);
    if (definition?.source !== 'integration') {
      return key;
    }

    const integration = (
      await this._integrationService.getIntegrationsList(orgId)
    ).find((current) => current.id === key);

    if (!integration) {
      throw new NotFoundException('Channel not found');
    }

    return channelDocumentKey(
      integration.providerIdentifier,
      integration.internalId
    );
  }

  private async channelKeysToIds(orgId: string) {
    const integrations = await this._integrationService.getIntegrationsList(
      orgId
    );

    return new Map(
      integrations.map((integration) => [
        channelDocumentKey(
          integration.providerIdentifier,
          integration.internalId
        ),
        integration.id,
      ])
    );
  }
}
