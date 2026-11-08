import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BriefRepository } from '@gitroom/nestjs-libraries/database/prisma/brief/brief.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  BriefKitDto,
  SaveBriefDocumentDto,
} from '@gitroom/nestjs-libraries/dtos/brief/brief.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  BRIEF_ONBOARDING_DOCUMENTS,
  BRIEF_REGISTRY,
  BRIEF_REGISTRY_VERSION,
  isAgentManaged,
  isDocumentEmpty,
  BRIEF_ASSETS_MAX,
  BRIEF_ASSET_URL_MAX,
  BRIEF_KIT_COLOR_ROLES,
  BRIEF_KIT_FONT_ROLES,
  BRIEF_KIT_HEX,
  BRIEF_KIT_IMAGERY_MAX,
  BRIEF_KIT_LOGO_VARIANTS,
  BRIEF_USER_DOCUMENTS_MAX,
  channelDocumentKey,
  documentHasFeature,
  emptyContent,
  findCategory,
  isKitEmpty,
  resolveDocumentDef,
} from '@gitroom/nestjs-libraries/agent-brief/brief.registry';
import {
  BriefDocument,
  BriefDocumentContent,
  BriefKit,
} from '@gitroom/nestjs-libraries/agent-brief/brief.types';
import { GOOGLE_FONT_FAMILIES } from '@gitroom/nestjs-libraries/agent-brief/google.fonts';
import { BriefRevisionService } from '@gitroom/nestjs-libraries/database/prisma/brief/brief-revision.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

// Google's spelling of each family, looked up without regard to case.
const GOOGLE_FONTS = new Map(
  GOOGLE_FONT_FAMILIES.map((family) => [family.toLowerCase(), family])
);

@Injectable()
export class BriefService {
  constructor(
    private _briefRepository: BriefRepository,
    private _integrationService: IntegrationService,
    private _briefRevisionService: BriefRevisionService,
    private _integrationManager: IntegrationManager
  ) {}

  // Every write goes through here so a document's history is recoverable and
  // the agent can see what changed. Never allowed to fail the save itself.
  private async capture(
    orgId: string,
    category: string,
    storageKey: string,
    content: BriefDocumentContent,
    options?: { deleted?: boolean }
  ) {
    try {
      await this._briefRevisionService.capture(
        orgId,
        category,
        storageKey,
        content,
        options
      );
    } catch (err) {}
  }

  // Why a category/key pair is not a document, in words that say what would
  // have been accepted instead.
  private unknownDocument(category: string, key: string) {
    const definition = findCategory(category);
    if (!definition) {
      return new NotFoundException(
        `Unknown category "${category}". Use one of: ${BRIEF_REGISTRY.map(
          (one) => one.id
        ).join(', ')}.`
      );
    }

    return new NotFoundException(
      `"${key}" is not a ${definition.label} document, and new ones cannot be added there. Allowed keys: ${(
        definition.documents || []
      )
        .map((document) => document.key)
        .join(', ')}.`
    );
  }

  async getDocuments(orgId: string) {
    const [rows, channelKeys] = await Promise.all([
      this._briefRepository.getDocuments(orgId),
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
    }, [] as BriefDocument[]);

    return { registryVersion: BRIEF_REGISTRY_VERSION, documents };
  }

  async saveDocument(
    orgId: string,
    category: string,
    key: string,
    body: SaveBriefDocumentDto
  ) {
    const definition = findCategory(category);
    const document = resolveDocumentDef(category, key);
    if (!definition || !document) {
      throw this.unknownDocument(category, key);
    }

    const problem = body.kit && this.kitProblem(category, key, body.kit);
    if (problem) {
      throw new BadRequestException(problem);
    }

    const storageKey = await this.toStorageKey(orgId, category, key);
    const existing = await this._briefRepository.getDocument(
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

    if (body.kit && documentHasFeature(document, 'kit')) {
      const kit = this.mergeKit(content.kit, body.kit);
      if (kit) {
        content.kit = kit;
      } else {
        delete content.kit;
      }
    }

    if (body.title !== undefined && definition.source === 'user') {
      content.title = body.title;
    }

    const saved = await this._briefRepository.saveDocument(
      orgId,
      category,
      storageKey,
      JSON.stringify(content)
    );

    await this.capture(orgId, category, storageKey, content);

    return {
      category,
      key,
      content,
      updatedAt: saved.updatedAt?.toISOString(),
    };
  }

  // Why a brand kit cannot be saved on this document, in the words both the
  // public API and briefSaveTool answer with. Nothing when it can be. An
  // unknown document is left to saveDocument to explain.
  kitProblem(category: string, key: string, kit: BriefKitDto) {
    const document = resolveDocumentDef(category, key);
    if (!document) {
      return undefined;
    }

    if (!documentHasFeature(document, 'kit')) {
      const holder = BRIEF_REGISTRY.flatMap((one) =>
        (one.documents || []).map((def) => ({ category: one.id, def }))
      ).find(({ def }) => documentHasFeature(def, 'kit'));
      return `Not saved: "kit" belongs to the ${holder?.def.key} document (category ${holder?.category}); this document holds no kit.`;
    }

    const twice = (values: string[]) =>
      values.find((value, at) => values.indexOf(value) !== at);
    const colorRoles: readonly string[] = BRIEF_KIT_COLOR_ROLES;
    const fontRoles: readonly string[] = BRIEF_KIT_FONT_ROLES;
    const logoVariants: readonly string[] = BRIEF_KIT_LOGO_VARIANTS;

    for (const color of kit.colors || []) {
      if (!colorRoles.includes(color.role)) {
        return `Not saved: a colour role is one of ${colorRoles.join(
          ', '
        )}; "${color.role}" is none of them.`;
      }
      if (!BRIEF_KIT_HEX.test(color.hex)) {
        return `Not saved: the colour for "${color.role}" is "${color.hex}" and a hex colour reads as six hex digits, like #0E1A2B.`;
      }
    }

    const colorTwice = twice((kit.colors || []).map((color) => color.role));
    if (colorTwice) {
      return `Not saved: "${colorTwice}" is sent twice; the kit holds one colour per role (${colorRoles.join(
        ', '
      )}).`;
    }

    for (const font of kit.fonts || []) {
      if (!fontRoles.includes(font.role)) {
        return `Not saved: a font role is one of ${fontRoles.join(
          ', '
        )}; "${font.role}" is neither.`;
      }
      if (!GOOGLE_FONTS.has(font.family.trim().toLowerCase())) {
        return `Not saved: "${font.family}" is not a Google Fonts family. Pick one from fonts.google.com, for example "Inter" or "Playfair Display".`;
      }
    }

    const fontTwice = twice((kit.fonts || []).map((font) => font.role));
    if (fontTwice) {
      return `Not saved: "${fontTwice}" is sent twice; the kit holds one font per role (${fontRoles.join(
        ', '
      )}).`;
    }

    for (const logo of kit.logos || []) {
      if (!logoVariants.includes(logo.variant)) {
        return `Not saved: a logo variant is one of ${logoVariants.join(
          ', '
        )}; "${logo.variant}" is none of them.`;
      }
      if (!logo.url.trim() || logo.url.length > BRIEF_ASSET_URL_MAX) {
        return `Not saved: the "${logo.variant}" logo needs its file, as a media-library path or a link of up to ${BRIEF_ASSET_URL_MAX} characters.`;
      }
    }

    const logoTwice = twice((kit.logos || []).map((logo) => logo.variant));
    if (logoTwice) {
      return `Not saved: "${logoTwice}" is sent twice; the kit holds one logo per variant (${logoVariants.join(
        ', '
      )}).`;
    }

    if ((kit.imagery || '').length > BRIEF_KIT_IMAGERY_MAX) {
      return `Not saved: the imagery line is ${
        (kit.imagery || '').length
      } characters; it holds up to ${BRIEF_KIT_IMAGERY_MAX}.`;
    }

    return undefined;
  }

  // Each kit field sent replaces that field whole and a field left out keeps
  // what is stored, the same contract as blocks, links and assets. Entries are
  // kept in role order, and a kit with nothing left in it is no kit at all.
  private mergeKit(stored: BriefKit | undefined, sent: BriefKitDto) {
    const kit: BriefKit = { ...(stored || {}) };

    if (sent.colors) {
      kit.colors = BRIEF_KIT_COLOR_ROLES.flatMap((role) => {
        const color = sent.colors!.find((one) => one.role === role);
        return color ? [{ role, hex: color.hex.toUpperCase() }] : [];
      });
    }

    if (sent.fonts) {
      kit.fonts = BRIEF_KIT_FONT_ROLES.flatMap((role) => {
        const font = sent.fonts!.find((one) => one.role === role);
        const family =
          font && GOOGLE_FONTS.get(font.family.trim().toLowerCase());
        return family ? [{ role, family }] : [];
      });
    }

    if (sent.logos) {
      kit.logos = BRIEF_KIT_LOGO_VARIANTS.flatMap((variant) => {
        const logo = sent.logos!.find((one) => one.variant === variant);
        return logo ? [{ variant, url: logo.url.trim() }] : [];
      });
    }

    if (sent.imagery !== undefined) {
      kit.imagery = sent.imagery.trim();
    }

    const merged: BriefKit = {
      ...(kit.colors?.length ? { colors: kit.colors } : {}),
      ...(kit.fonts?.length ? { fonts: kit.fonts } : {}),
      ...(kit.logos?.length ? { logos: kit.logos } : {}),
      ...(kit.imagery ? { imagery: kit.imagery } : {}),
    };

    return isKitEmpty(merged) ? undefined : merged;
  }

  // The headings a stored document holds that a new list of rules leaves out,
  // matched trimmed and case-insensitively. An unknown document has none, so
  // saveDocument is the one to explain why it is not a document.
  async missingHeadings(
    orgId: string,
    category: string,
    key: string,
    headings: string[]
  ) {
    if (!resolveDocumentDef(category, key)) {
      return [];
    }

    const storageKey = await this.toStorageKey(orgId, category, key);
    const existing = await this._briefRepository.getDocument(
      orgId,
      category,
      storageKey
    );
    if (!existing) {
      return [];
    }

    const normalise = (heading?: string) =>
      (heading || '').trim().toLowerCase();
    const sent = new Set(headings.map(normalise));

    return Array.from(
      new Set(
        this.parseContent(existing.content)
          .blocks.map((block) => (block.heading || '').trim())
          .filter((heading) => heading && !sent.has(normalise(heading)))
      )
    );
  }

  async deleteDocument(
    orgId: string,
    category: string,
    key: string,
    viaAgent = false,
    // Keep the document's history and record the removal in it, rather than
    // wiping it. Used when a redone onboarding replaces the brief, so what it
    // removed can still be seen afterwards.
    keepHistory = false,
    // Answer { deleted: false } when nothing is stored under that key, rather
    // than reporting a delete.
    reportMissing = false
  ) {
    const definition = findCategory(category);
    if (!definition || !resolveDocumentDef(category, key)) {
      throw this.unknownDocument(category, key);
    }

    // Registry documents are emptied rather than removed, so only a category
    // that says canDelete can lose one. On top of that, the agent may always
    // retire a note of its own, whatever the category allows people to do.
    const allowed =
      !!definition.canDelete || (!!definition.agentManaged && viaAgent);

    if (!allowed) {
      throw new BadRequestException('This document cannot be deleted');
    }

    const storageKey = await this.toStorageKey(orgId, category, key);
    const existing =
      keepHistory || reportMissing
        ? await this._briefRepository.getDocument(orgId, category, storageKey)
        : null;

    if (reportMissing && !existing) {
      return { deleted: false };
    }

    await this._briefRepository.deleteDocument(orgId, category, storageKey);

    if (!keepHistory) {
      // A document that is gone leaves no history behind, same as a deleted
      // post.
      try {
        await this._briefRevisionService.deleteDocument(
          orgId,
          category,
          storageKey
        );
      } catch (err) {}
    } else if (existing) {
      // The history is kept and the removal recorded in it. Only the
      // document's name is kept in that record.
      const { title } = this.parseContent(existing.content);
      await this.capture(
        orgId,
        category,
        storageKey,
        { ...emptyContent(), ...(title ? { title } : {}) },
        { deleted: true }
      );
    }

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

    const existing = await this._briefRepository.getDocument(
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

    const saved = await this._briefRepository.saveDocument(
      orgId,
      category,
      key,
      JSON.stringify(content)
    );

    await this.capture(orgId, category, key, content);

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

    const existing = await this._briefRepository.getDocument(
      orgId,
      category,
      key
    );

    const content = this.parseContent(existing?.content);
    const assets = content.assets || [];

    if (assets.length >= BRIEF_ASSETS_MAX) {
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

    await this._briefRepository.saveDocument(
      orgId,
      category,
      key,
      JSON.stringify(content)
    );

    await this.capture(orgId, category, key, content);

    return { assets: content.assets.length };
  }

  // Takes files off Branding & assets by id, leaving the rules and every
  // other file as they are. Ids that are not there are reported back.
  async removeAssets(orgId: string, assetIds: string[]) {
    const category = 'foundation';
    const key = 'branding-assets';

    const existing = await this._briefRepository.getDocument(
      orgId,
      category,
      key
    );

    const content = this.parseContent(existing?.content);
    const assets = content.assets || [];
    const wanted = new Set(assetIds);
    const kept = assets.filter((asset) => !wanted.has(asset.id));
    const removed = assets
      .filter((asset) => wanted.has(asset.id))
      .map((asset) => asset.id);
    const notFound = assetIds.filter((id) => !removed.includes(id));

    if (existing && removed.length) {
      content.assets = kept;
      await this._briefRepository.saveDocument(
        orgId,
        category,
        key,
        JSON.stringify(content)
      );
      await this.capture(orgId, category, key, content);
    }

    return { removed, notFound, assets: kept.length };
  }

  // Which onboarding documents are filled in yet: the Foundation's core
  // documents, then one per connected channel (how that account is used).
  // Onboarding ends once all of them are, and the onboarding screen and the
  // briefStatus tool both read this.
  async onboardingStatus(orgId: string) {
    const [{ documents }, integrations] = await Promise.all([
      this.getDocuments(orgId),
      this._integrationService.getIntegrationsList(orgId),
    ]);
    const stored = (category: string, key: string) =>
      documents.find(
        (document) => document.category === category && document.key === key
      )?.content;
    const filled = (category: string, key: string) =>
      !isDocumentEmpty(stored(category, key));
    const foundation = BRIEF_ONBOARDING_DOCUMENTS.map((key) => {
      const definition = resolveDocumentDef('foundation', key);
      return {
        category: 'foundation',
        key,
        label: definition?.label || key,
        description: definition?.description || '',
        filled: filled('foundation', key),
        files: stored('foundation', key)?.assets?.length || 0,
      };
    });
    const channels = integrations
      .filter(
        (integration) => !integration.disabled && !integration.inBetweenSteps
      )
      .map((integration) => {
        // "X preferences (voholabs)": the platform, then the account.
        const platform = (
          this._integrationManager?.getSocialIntegration(
            integration.providerIdentifier
          )?.name || integration.providerIdentifier
        )
          .split('\n')[0]
          .trim();
        const account = integration.profile || integration.name;
        return {
          category: 'channels',
          // Channel documents are saved under the integration id.
          key: integration.id,
          label: `${platform} preferences (${account})`,
          description: `How the ${platform} account "${account}" is used: what to post there, how often, in what form and tone.`,
          filled: filled('channels', integration.id),
          files: stored('channels', integration.id)?.assets?.length || 0,
        };
      });
    const required = [...foundation, ...channels];
    return {
      done: required.every((document) => document.filled),
      documents: required,
    };
  }

  // Everything the agent knows about the business, as one structure. Nothing
  // consumes this yet.
  async getBrief(orgId: string) {
    const { documents } = await this.getDocuments(orgId);
    return documents;
  }

  private parseContent(raw?: string): BriefDocumentContent {
    try {
      const parsed = JSON.parse(raw || '{}');
      return {
        v: 1,
        blocks: Array.isArray(parsed?.blocks) ? parsed.blocks : [],
        ...(parsed?.links ? { links: parsed.links } : {}),
        ...(parsed?.assets ? { assets: parsed.assets } : {}),
        ...(parsed?.kit ? { kit: parsed.kit } : {}),
        ...(parsed?.title ? { title: parsed.title } : {}),
      };
    } catch (err) {
      return emptyContent();
    }
  }

  private async assertRoomForAnother(orgId: string, category: string) {
    const existing = await this._briefRepository.countDocuments(
      orgId,
      category
    );

    if (existing >= BRIEF_USER_DOCUMENTS_MAX) {
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
