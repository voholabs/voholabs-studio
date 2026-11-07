import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { FlowSource, Prisma } from '@prisma/client';
import {
  UserFlowData,
  UserFlowsRepository,
} from '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.repository';
import { scrubFlow } from '@gitroom/nestjs-libraries/flows/flows.scrub';
import type { LibraryFlowSource } from '@gitroom/nestjs-libraries/flows/flows.service';
import {
  USER_FLOW_BODY_MAX,
  USER_FLOW_CATEGORY_MAX,
  USER_FLOW_COST_MAX,
  USER_FLOW_LIBRARY_ID_MAX,
  USER_FLOW_LIST_ITEM_MAX,
  USER_FLOW_LIST_MAX,
  USER_FLOW_PART_KEY_MAX,
  USER_FLOW_PARTS_MAX,
  USER_FLOW_SLUG,
  USER_FLOW_SLUG_MAX,
  USER_FLOW_TEXT_MAX,
  USER_FLOW_TITLE_MAX,
  USER_FLOW_TOKEN_MAX,
} from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

// The fields a flow is written with, from the app, the MCP gateway or a fork.
export interface UserFlowInput {
  slug?: string;
  title?: string;
  whenToUse?: string;
  summary?: string;
  body?: string;
  parts?: Record<string, string> | null;
  category?: string | null;
  cost?: string | null;
  foundation?: string[];
  brandSlots?: string[];
  poster?: string | null;
  exampleVideo?: string | null;
}

export interface SaveUserFlowOptions {
  // How a new flow came to be.
  source?: FlowSource;
  // The origin of a fork (a library flow id).
  forkOf?: string;
  // A share token: the flow is copied from that share, scrubbed.
  importToken?: string;
  // An existing flow with this slug is edited (the MCP's save). Otherwise a
  // taken slug gets a free one next to it, so nothing is overwritten.
  overwrite?: boolean;
}

export interface SaveUserFlowResult {
  slug: string;
  created: boolean;
  warnings: string[];
}

// Words the /user-flows routes use next to a slug.
const RESERVED_SLUGS = ['shared', 'fork', 'import', 'new'];

// A copy of a library flow holds Voho's method, which stays with workspaces
// that have Plus: it gets no share link.
export const LIBRARY_COPY_NOT_SHAREABLE =
  'A copy of a Voho library flow cannot be shared. Flows you wrote yourself or imported from a share link can be.';

// "Carousel for launches!" -> "carousel-for-launches"
export const slugify = (title: string) => {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'flow';
};

export const shareUrl = (token: string) =>
  `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/flows/shared/${token}`;

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : undefined;

const list = (value: unknown, max = USER_FLOW_LIST_ITEM_MAX) => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return [
    ...new Set(
      value
        .map((one) => text(one, max))
        .filter((one): one is string => !!one)
    ),
  ].slice(0, USER_FLOW_LIST_MAX);
};

const nullable = (value: unknown, max: number) =>
  value === null ? null : text(value, max) || (value === '' ? null : undefined);

const httpsOrNull = (value: unknown) => {
  if (value === null) {
    return null;
  }
  const url = text(value, 2048);
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

const parts = (value: unknown) => {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('parts is an object of named texts');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > USER_FLOW_PARTS_MAX) {
    throw new BadRequestException(
      `A flow has at most ${USER_FLOW_PARTS_MAX} parts`
    );
  }
  for (const [key, part] of entries) {
    if (
      !new RegExp(`^[A-Za-z0-9._-]{1,${USER_FLOW_PART_KEY_MAX}}$`).test(key) ||
      typeof part !== 'string' ||
      part.length > USER_FLOW_BODY_MAX
    ) {
      throw new BadRequestException(`The part "${key}" is not a usable text`);
    }
  }
  return entries.length
    ? (Object.fromEntries(entries) as Record<string, string>)
    : null;
};

type CleanFlow = Omit<Partial<UserFlowData>, 'parts'> & {
  parts?: Record<string, string> | null;
};

// The writable fields of an input, cleaned; a field left out stays undefined
// so an edit keeps what is stored.
const toData = (input: UserFlowInput): CleanFlow => {
  const body = typeof input.body === 'string' ? input.body : undefined;
  if (body !== undefined && body.length > USER_FLOW_BODY_MAX) {
    throw new BadRequestException('The flow is too long');
  }
  const category = nullable(input.category, USER_FLOW_CATEGORY_MAX);
  const data: CleanFlow = {
    title: text(input.title, USER_FLOW_TITLE_MAX) || undefined,
    whenToUse: text(input.whenToUse, USER_FLOW_TEXT_MAX),
    summary: text(input.summary, USER_FLOW_TEXT_MAX),
    body,
    parts: parts(input.parts),
    category: typeof category === 'string' ? category.toLowerCase() : category,
    cost: nullable(input.cost, USER_FLOW_COST_MAX),
    foundation: list(input.foundation),
    brandSlots: list(input.brandSlots, 40),
    poster: httpsOrNull(input.poster),
    exampleVideo: httpsOrNull(input.exampleVideo),
  };
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as CleanFlow;
};

// As the database takes it: no parts is a JSON null.
const forDb = ({ parts: value, ...data }: CleanFlow): Partial<UserFlowData> => ({
  ...data,
  ...(value === undefined
    ? {}
    : { parts: value === null ? Prisma.DbNull : value }),
});

// What a save would carry of a brand (colour codes, media links, our name),
// said, not changed.
const brandWarnings = (data: CleanFlow) =>
  scrubFlow(
    {
      title: data.title,
      whenToUse: data.whenToUse,
      summary: data.summary,
      body: data.body,
      parts: data.parts,
    },
    false
  ).warnings;

const partsOf = (value: Prisma.JsonValue | null) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : null;

// A workspace's own flows ("My flows"): saved from a chat through the MCP
// gateway, written in the app, forked from the Voho library or imported from
// a share link. Method and style only: brand facts are attached by the
// gateway when a flow is read, and an imported flow is scrubbed of the
// author's.
@Injectable()
export class UserFlowsService {
  constructor(private _flows: UserFlowsRepository) {}

  async list(organizationId: string) {
    const rows = await this._flows.list(organizationId);
    return Promise.all(
      rows.map(async ({ shares, forkedFromId, ...row }) => ({
        ...row,
        shared: shares.length > 0,
        shareable: !(await this.fromLibrary(organizationId, {
          source: row.source,
          forkedFromId,
        })),
      }))
    );
  }

  async get(organizationId: string, slug: string) {
    const key = this.validSlug(slug);
    const row = key ? await this._flows.get(organizationId, key) : null;
    if (!row) {
      return null;
    }
    const { shares, parts: stored, ...flow } = row;
    const token = shares[0]?.token;
    return {
      ...flow,
      parts: partsOf(stored),
      shared: !!token,
      shareUrl: token ? shareUrl(token) : null,
    };
  }

  // Saves a flow. With importToken it is copied from that share (scrubbed);
  // with forkOf it records where it came from. Never refuses for brand
  // content: it says so in warnings.
  async save(
    organizationId: string,
    input: UserFlowInput,
    options: SaveUserFlowOptions = {}
  ): Promise<SaveUserFlowResult> {
    if (options.importToken) {
      return this.importShare(organizationId, options.importToken, input);
    }

    const data = toData(input);
    const warnings = brandWarnings(data);
    const forkOf = text(options.forkOf, USER_FLOW_LIBRARY_ID_MAX) || undefined;
    const wanted = input.slug ? this.validSlug(input.slug) : undefined;
    if (input.slug && !wanted) {
      throw new BadRequestException(
        'A slug is lower-case letters, digits and dashes'
      );
    }

    // An edit of an existing flow, through the MCP's save.
    if (wanted && options.overwrite && !forkOf) {
      const existing = await this._flows.slugRow(organizationId, wanted);
      if (existing && !existing.deletedAt) {
        await this._flows.update(existing.id, forDb(data));
        return { slug: wanted, created: false, warnings };
      }
    }

    if (!data.title) {
      throw new BadRequestException('A flow needs a title');
    }
    const slug = await this.freeSlug(
      organizationId,
      wanted || slugify(data.title)
    );
    const source: FlowSource = forkOf
      ? 'FORKED'
      : options.source || 'CREATED';
    await this._flows.create(organizationId, slug, {
      ...(forDb(data) as UserFlowData),
      source,
      forkedFromId: forkOf || null,
      importedShareId: null,
    });
    return { slug, created: true, warnings };
  }

  // An edit from the app (PATCH): only the fields given change.
  async update(organizationId: string, slug: string, input: UserFlowInput) {
    const key = this.validSlug(slug);
    const existing = key
      ? await this._flows.slugRow(organizationId, key)
      : null;
    if (!key || !existing || existing.deletedAt) {
      throw new NotFoundException('Flow not found');
    }
    const data = toData({ ...input, slug: undefined });
    await this._flows.update(existing.id, forDb(data));
    return { slug: key, created: false, warnings: brandWarnings(data) };
  }

  // A Voho library flow, read from the gateway, as a new flow of this
  // workspace.
  fork(organizationId: string, source: LibraryFlowSource, slug?: string) {
    return this.save(
      organizationId,
      {
        slug,
        title: source.title,
        whenToUse: source.whenToUse,
        summary: source.summary,
        body: source.body,
        parts: source.parts,
        category: source.category,
        cost: source.cost,
        foundation: source.foundation,
        brandSlots: source.brandSlots,
        poster: source.poster,
        exampleVideo: source.exampleVideo,
      },
      { forkOf: source.id }
    );
  }

  // The share link of a flow, made the first time it is asked for.
  async share(organizationId: string, slug: string) {
    const flow = await this.existing(organizationId, slug);
    if (await this.fromLibrary(organizationId, flow)) {
      throw new BadRequestException(LIBRARY_COPY_NOT_SHAREABLE);
    }
    const token =
      (await this._flows.activeShare(flow.id))?.token ||
      (
        await this._flows.createShare(
          organizationId,
          flow.id,
          randomBytes(18).toString('base64url')
        )
      ).token;
    return { url: shareUrl(token), token };
  }

  async revoke(organizationId: string, slug: string) {
    const flow = await this.existing(organizationId, slug);
    const { count } = await this._flows.revokeShares(flow.id);
    return { revoked: count > 0 };
  }

  // Deleting also turns its share link off.
  async delete(organizationId: string, slug: string) {
    const flow = await this.existing(organizationId, slug);
    await this._flows.revokeShares(flow.id);
    await this._flows.softDelete(flow.id);
    return { deleted: true };
  }

  // What a share link holds, for the signed-in shared page: the method, and
  // what the import would change.
  async shared(token: string) {
    const share = await this.liveShare(token);
    const { flow, warnings } = scrubFlow({
      ...share.userFlow,
      parts: partsOf(share.userFlow.parts),
    });
    return { flow, warnings };
  }

  // Imports a shared flow as a new flow of this workspace (from the app).
  import(organizationId: string, token: string, slug?: string) {
    return this.save(organizationId, { slug }, { importToken: token });
  }

  private async importShare(
    organizationId: string,
    token: string,
    input: UserFlowInput
  ): Promise<SaveUserFlowResult> {
    const share = await this.liveShare(token);
    const { flow, warnings } = scrubFlow({
      ...share.userFlow,
      parts: partsOf(share.userFlow.parts),
    });
    const wanted = input.slug ? this.validSlug(input.slug) : undefined;
    if (input.slug && !wanted) {
      throw new BadRequestException(
        'A slug is lower-case letters, digits and dashes'
      );
    }
    const title = text(input.title, USER_FLOW_TITLE_MAX) || flow.title;
    const data = toData({
      title,
      whenToUse: flow.whenToUse,
      summary: flow.summary,
      body: flow.body,
      parts: flow.parts,
      category: flow.category,
      cost: flow.cost,
      foundation: flow.foundation,
      brandSlots: flow.brandSlots,
    });
    const slug = await this.freeSlug(
      organizationId,
      wanted || slugify(title)
    );
    await this._flows.create(organizationId, slug, {
      ...(forDb(data) as UserFlowData),
      source: 'IMPORTED',
      forkedFromId: null,
      importedShareId: share.id,
    });
    await this._flows.countImport(share.id);
    return { slug, created: true, warnings };
  }

  private async liveShare(token: string) {
    const key = text(token, USER_FLOW_TOKEN_MAX);
    const share = key ? await this._flows.shared(key) : null;
    // A link to a copy of a library flow opens nothing, whenever it was made.
    if (!share || (await this.fromLibrary(share.organizationId, share.userFlow))) {
      throw new NotFoundException(
        'This share link was turned off or never existed'
      );
    }
    const { source, forkedFromId, ...userFlow } = share.userFlow;
    return { ...share, userFlow };
  }

  // Whether a flow is a copy of a Voho library flow: forked from one, or
  // forked from a flow of this workspace that is. Its method is Voho's, so it
  // is never shared (a share link opens to anyone signed in to Studio).
  private async fromLibrary(
    organizationId: string,
    flow: { source: FlowSource; forkedFromId: string | null },
    depth = 0
  ): Promise<boolean> {
    if (flow.source !== 'FORKED' || !flow.forkedFromId) {
      return false;
    }
    if (!flow.forkedFromId.startsWith('my/') || depth >= 5) {
      return true;
    }
    const parent = await this._flows.origin(
      organizationId,
      flow.forkedFromId.slice(3)
    );
    return !!parent && this.fromLibrary(organizationId, parent, depth + 1);
  }

  private async existing(organizationId: string, slug: string) {
    const key = this.validSlug(slug);
    const flow = key ? await this._flows.get(organizationId, key) : null;
    if (!flow) {
      throw new NotFoundException('Flow not found');
    }
    return flow;
  }

  private validSlug(slug: string) {
    const key = (slug || '').trim().toLowerCase();
    return key.length <= USER_FLOW_SLUG_MAX && USER_FLOW_SLUG.test(key)
      ? key
      : undefined;
  }

  // The slug itself when nothing (not even a deleted flow) has it and it is
  // not a word the routes use, otherwise the first free "<slug>-2", "-3"...
  private async freeSlug(organizationId: string, slug: string) {
    const base = RESERVED_SLUGS.includes(slug) ? `${slug}-flow` : slug;
    const taken = new Set(
      (await this._flows.slugsLike(organizationId, base)).map((row) => row.slug)
    );
    if (!taken.has(base)) {
      return base;
    }
    const stem = base.slice(0, USER_FLOW_SLUG_MAX - 4);
    for (let n = 2; ; n++) {
      const next = `${stem}-${n}`;
      if (!taken.has(next)) {
        return next;
      }
    }
  }
}
