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
import { SkillsService } from '@gitroom/nestjs-libraries/database/prisma/skills/skills.service';
import {
  MY_SKILL,
  SharedUserSkill,
  UserSkillsService,
} from '@gitroom/nestjs-libraries/database/prisma/user-skills/user-skills.service';
import {
  nextFreeSlug,
  slugify,
} from '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.slug';
import type { LibraryFlowSource } from '@gitroom/nestjs-libraries/flows/flows.service';
import {
  USER_FLOW_BASED_ON,
  USER_FLOW_BASED_ON_MAX,
  USER_FLOW_BODY_MAX,
  USER_FLOW_CATEGORY_MAX,
  USER_FLOW_CHAIN_MAX,
  USER_FLOW_COST_MAX,
  USER_FLOW_LIBRARY_ID_MAX,
  USER_FLOW_LIST_ITEM_MAX,
  USER_FLOW_LIST_MAX,
  USER_FLOW_PART_KEY_MAX,
  USER_FLOW_PARTS_MAX,
  USER_FLOW_CUSTOMIZATION_MAX,
  USER_FLOW_SKILL_SLUG_MAX,
  USER_FLOW_SKILLS_MAX,
  USER_FLOW_SLUG,
  USER_FLOW_SLUG_MAX,
  USER_FLOW_TEXT_MAX,
  USER_FLOW_TITLE_MAX,
  USER_FLOW_TOKEN_MAX,
  SKILL_CHIP,
} from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

export { slugify };

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
  // A custom flow: the flow it is based on (a library flow id or
  // "my/<slug>"; null for none) and what it changes.
  basedOn?: string | null;
  customization?: string;
  // Skills brought in without a skill link in the texts (a skills library
  // slug or "my/<slug>"), added to the ones the links name.
  skills?: string[];
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

// How a base among this workspace's own flows is named.
const MY = 'my/';

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

// A base as stored: a library flow id or "my/<slug>", null for none.
const basedOn = (value: unknown) => {
  if (value === null || value === '') {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  const base = typeof value === 'string' ? value.trim() : '';
  if (base.length > USER_FLOW_BASED_ON_MAX || !USER_FLOW_BASED_ON.test(base)) {
    throw new BadRequestException(
      'The base is a Voho library flow id or "my/<slug>".'
    );
  }
  return base;
};

const TOO_MANY_SKILLS = `A flow has at most ${USER_FLOW_SKILLS_MAX} skills.`;

const skills = (value: unknown) => {
  const slugs = list(value, USER_FLOW_SKILL_SLUG_MAX);
  if (slugs && slugs.length > USER_FLOW_SKILLS_MAX) {
    throw new BadRequestException(TOO_MANY_SKILLS);
  }
  return slugs;
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

type CleanFlow = Omit<Partial<UserFlowData>, 'parts' | 'skills'> & {
  parts?: Record<string, string> | null;
  skills?: string[];
};

// The writable fields of an input, cleaned; a field left out stays undefined
// so an edit keeps what is stored.
const toData = (input: UserFlowInput): CleanFlow => {
  const body = typeof input.body === 'string' ? input.body : undefined;
  if (body !== undefined && body.length > USER_FLOW_BODY_MAX) {
    throw new BadRequestException('The flow is too long');
  }
  const customization =
    typeof input.customization === 'string' ? input.customization : undefined;
  if (
    customization !== undefined &&
    customization.length > USER_FLOW_CUSTOMIZATION_MAX
  ) {
    throw new BadRequestException('The customization is too long');
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
    basedOn: basedOn(input.basedOn),
    customization: customization?.trim(),
    skills: skills(input.skills),
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
      customization: data.customization,
      parts: data.parts,
    },
    false
  ).warnings;

const partsOf = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : null;

const unique = (values: string[]) => [...new Set(values)];

// The texts of a flow that hold skill links.
interface FlowTexts {
  body?: string;
  customization?: string;
  parts?: unknown;
}

// The skill references the skill links in a flow's texts name, in order:
// the body, the customization, then each part.
export const skillLinks = (flow: FlowTexts) =>
  unique(
    [
      flow.body,
      flow.customization,
      ...Object.values(partsOf(flow.parts) || {}),
    ].flatMap((one) =>
      typeof one === 'string'
        ? [...one.matchAll(SKILL_CHIP)].map((match) => match[2])
        : []
    )
  );

// A flow's skills, as its index holds them: the skills its links name,
// then the ones listed without a link.
const skillIndex = (texts: FlowTexts, listed: string[]) => {
  const linked = skillLinks(texts);
  return {
    linked,
    index: unique([
      ...linked,
      ...listed.filter((one) => !linked.includes(one)),
    ]),
  };
};

// The skills index a save writes: the skills the links in the flow's texts
// name, then the ones given without a link. An edit that gives none keeps
// the stored ones that no stored link named. An edit that changes no text
// and gives no skills leaves the index as it is.
const withSkillIndex = (
  data: CleanFlow,
  stored?: FlowTexts & { skills: string[] }
): CleanFlow => {
  const touched =
    data.body !== undefined ||
    data.customization !== undefined ||
    data.parts !== undefined ||
    data.skills !== undefined;
  if (stored && !touched) {
    return data;
  }
  const storedLinks = stored ? skillLinks(stored) : [];
  const { index } = skillIndex(
    {
      body: data.body ?? stored?.body,
      customization: data.customization ?? stored?.customization,
      parts: data.parts === undefined ? stored?.parts : data.parts,
    },
    data.skills ??
      (stored?.skills || []).filter((one) => !storedLinks.includes(one))
  );
  if (index.length > USER_FLOW_SKILLS_MAX) {
    throw new BadRequestException(TOO_MANY_SKILLS);
  }
  return { ...data, skills: index };
};

// One link of a chain of bases: what a flow adds to the ones based on it.
interface FlowLink {
  slug: string;
  basedOn: string | null;
  customization: string;
  skills: string[];
  body: string;
  parts: unknown;
  cost: string | null;
  foundation: string[];
}

// What tells whether a flow holds Voho's method.
interface LibraryLink {
  slug: string;
  basedOn: string | null;
  source: FlowSource;
  forkedFromId: string | null;
}

interface Ancestors<T> {
  // Nearest first.
  chain: T[];
  // The chain comes back to a flow already in it.
  cycle?: boolean;
  // The chain runs through more than USER_FLOW_CHAIN_MAX of My flows.
  tooDeep?: boolean;
  // The slug of a base that is gone.
  broken?: string;
}

// A skill a flow brings in, as the gateway reads it: its instructions, or
// locked (a skills library skill without the skills unlock) or missing (no
// longer in the skills library, or deleted from My skills). "slug" is the
// reference as stored: "hooks", or "my/<slug>" for one of My skills, which
// is never locked.
export interface FlowSkill {
  slug: string;
  kind: 'voho' | 'mine';
  name: string;
  summary: string;
  whenToUse: string | null;
  body?: string;
  locked?: true;
  missing?: true;
}

// A flow and the flows of this workspace it is based on, as one method: the
// customizations oldest first, the body of the chain's own root (none when it
// ends in a library flow, which the gateway reads itself), the parts merged
// with the nearer flow winning, the foundation of all, the nearest cost and
// every skill. A based-on flow that has a body of its own counts it as part of
// its customization.
const flatten = (flow: FlowLink, chain: FlowLink[]) => {
  const links = [flow, ...chain];
  const root = links[links.length - 1];
  const library =
    root.basedOn && !root.basedOn.startsWith(MY) ? root.basedOn : null;
  const ownRoot = library ? null : root;
  const oldestFirst = [...links].reverse();
  const merged = Object.assign(
    {},
    ...oldestFirst.map((link) => partsOf(link.parts) || {})
  ) as Record<string, string>;
  return {
    basedOn: library,
    customization: oldestFirst
      .map((link) =>
        [link.customization, link === ownRoot ? '' : link.body]
          .map((one) => (one || '').trim())
          .filter(Boolean)
          .join('\n\n')
      )
      .filter(Boolean)
      .join('\n\n'),
    body: ownRoot ? ownRoot.body : '',
    parts: Object.keys(merged).length ? merged : null,
    cost: links.find((link) => link.cost)?.cost ?? null,
    foundation: unique(links.flatMap((link) => link.foundation)),
    skills: unique(links.flatMap((link) => link.skills)),
  };
};

// What a read says when a chain of bases stops short (rows saved before the
// checks): the flow is read up to the last flow of the chain that could be
// read. Named gives the slugs, for the workspace's own agent; a share link
// names none of the author's.
const chainWarnings = (
  found: Ancestors<{ slug: string }>,
  flow: { slug: string },
  named: boolean
): string[] => {
  const last = found.chain[found.chain.length - 1]?.slug || flow.slug;
  const stop = named
    ? ` It is read up to "${MY}${last}".`
    : ' It is read up to the last flow that could be read.';
  if (found.broken) {
    return [
      `${
        named ? `The flow "${MY}${found.broken}"` : 'A flow'
      } it is based on no longer exists.${stop}`,
    ];
  }
  if (found.cycle) {
    return [`Its chain of bases loops back on itself.${stop}`];
  }
  if (found.tooDeep) {
    return [
      `Its chain of bases runs through more than ${USER_FLOW_CHAIN_MAX} of My flows.${stop}`,
    ];
  }
  return [];
};

// What an import of a shared flow keeps of a merged chain longer than one
// flow may hold, and the warnings that say so.
const importLimits = (flow: FlowTexts & { skills: string[] }) => {
  const customization = flow.customization || '';
  const kept = customization.slice(0, USER_FLOW_CUSTOMIZATION_MAX);
  // The same index a save derives, kept to the first USER_FLOW_SKILLS_MAX.
  const { linked, index } = skillIndex(
    { body: flow.body, customization: kept, parts: flow.parts },
    flow.skills
  );
  const warnings: string[] = [];
  if (customization.length > USER_FLOW_CUSTOMIZATION_MAX) {
    warnings.push(
      `The customization is longer than ${USER_FLOW_CUSTOMIZATION_MAX.toLocaleString(
        'en-US'
      )} characters; the imported flow keeps the first ${USER_FLOW_CUSTOMIZATION_MAX.toLocaleString(
        'en-US'
      )}.`
    );
  }
  if (index.length > USER_FLOW_SKILLS_MAX) {
    const dropped = index
      .slice(USER_FLOW_SKILLS_MAX)
      .filter((one) => linked.includes(one));
    warnings.push(
      `The flow brings in ${index.length} skills; the imported flow keeps the first ${USER_FLOW_SKILLS_MAX}.${
        dropped.length
          ? ` Its links to ${dropped
              .map((one) => `"${one}"`)
              .join(', ')} show as missing.`
          : ''
      }`
    );
  }
  return {
    customization: kept,
    skills: index.slice(0, USER_FLOW_SKILLS_MAX),
    warnings,
  };
};

// A workspace's own flows ("My flows"): saved from a chat through the MCP
// gateway, written in the app, forked from the Voho library or imported from
// a share link. Method and style only: brand facts are attached by the
// gateway when a flow is read, and an imported flow is scrubbed of the
// author's. A custom flow is based on another flow (a library flow or one of
// My flows) and holds only what it changes; the base is read when it runs.
@Injectable()
export class UserFlowsService {
  constructor(
    private _flows: UserFlowsRepository,
    private _skills: SkillsService,
    private _userSkills: UserSkillsService
  ) {}

  async list(organizationId: string) {
    const rows = await this._flows.list(organizationId);
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    return Promise.all(
      rows.map(async ({ shares, forkedFromId, ...row }) => ({
        ...row,
        shared: shares.length > 0,
        shareable: !(await this.holdsLibrary(
          organizationId,
          { ...row, forkedFromId },
          async (slug) => bySlug.get(slug) || null
        )),
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

  // One flow as its agent reads it: a custom flow merged with the flows of
  // this workspace it is based on (flatten), and the skills it brings in,
  // whole with the skills unlock, otherwise locked.
  async resolved(
    organizationId: string,
    slug: string,
    options: { skillsUnlocked: boolean }
  ) {
    const flow = await this.get(organizationId, slug);
    if (!flow) {
      return null;
    }
    const found = await this.ancestors(flow, (base) =>
      this._flows.base(organizationId, base)
    );
    const flat = flatten(flow, found.chain);
    return {
      ...flow,
      ...flat,
      skills: await this.skillsOf(
        organizationId,
        flat.skills,
        options.skillsUnlocked
      ),
      warnings: chainWarnings(found, flow, true),
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
      const existing = await this._flows.get(organizationId, wanted);
      if (existing) {
        const edit = withSkillIndex(data, existing);
        await this.checkReferences(
          organizationId,
          wanted,
          edit,
          existing.skills
        );
        await this._flows.update(existing.id, forDb(edit));
        return { slug: wanted, created: false, warnings };
      }
    }

    if (!data.title) {
      throw new BadRequestException('A flow needs a title');
    }
    const created = withSkillIndex(data);
    await this.checkReferences(organizationId, undefined, created);
    const slug = await this.freeSlug(
      organizationId,
      wanted || slugify(data.title)
    );
    const source: FlowSource = forkOf
      ? 'FORKED'
      : options.source || 'CREATED';
    await this._flows.create(organizationId, slug, {
      ...(forDb(created) as UserFlowData),
      source,
      forkedFromId: forkOf || null,
      importedShareId: null,
    });
    return { slug, created: true, warnings };
  }

  // An edit from the app (PATCH): only the fields given change.
  async update(organizationId: string, slug: string, input: UserFlowInput) {
    const key = this.validSlug(slug);
    const existing = key ? await this._flows.get(organizationId, key) : null;
    if (!key || !existing) {
      throw new NotFoundException('Flow not found');
    }
    const data = toData({ ...input, slug: undefined });
    const edit = withSkillIndex(data, existing);
    await this.checkReferences(organizationId, key, edit, existing.skills);
    await this._flows.update(existing.id, forDb(edit));
    return { slug: key, created: false, warnings: brandWarnings(data) };
  }

  // A Voho library flow, read from the gateway, as a new flow of this
  // workspace. Kept for older clients: the app no longer calls it.
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
    if (
      await this.holdsLibrary(organizationId, flow, (base) =>
        this._flows.base(organizationId, base)
      )
    ) {
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

  // Deleting also turns its share link off. A flow other flows are based on
  // stays until they are changed or deleted.
  async delete(organizationId: string, slug: string) {
    const flow = await this.existing(organizationId, slug);
    const dependents = await this._flows.dependents(organizationId, flow.slug);
    if (dependents.length) {
      const names = dependents.map((one) => `${MY}${one.slug}`).join(', ');
      throw new BadRequestException(
        dependents.length === 1
          ? `1 flow is based on this one (${names}). Change or delete it first.`
          : `${dependents.length} flows are based on this one (${names}). Change or delete them first.`
      );
    }
    await this._flows.revokeShares(flow.id);
    await this._flows.softDelete(flow.id);
    return { deleted: true };
  }

  // What a share link holds, for the signed-in shared page: the method, the
  // skills of the author's My skills it brings in (ownSkills, "slug" being
  // the reference in the flow), and what the import would change. A custom
  // flow carries its library base by id, never the base's method.
  async shared(token: string) {
    const share = await this.liveShare(token);
    const {
      flow: { ownSkills, ...flow },
      warnings,
    } = scrubFlow({ ...share.userFlow, ownSkills: share.ownSkills });
    return {
      flow,
      ownSkills: ownSkills || [],
      warnings: [...warnings, ...share.warnings, ...importLimits(flow).warnings],
    };
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
    const {
      flow: { ownSkills, ...flow },
      warnings: scrubbed,
    } = scrubFlow({ ...share.userFlow, ownSkills: share.ownSkills });
    const wanted = input.slug ? this.validSlug(input.slug) : undefined;
    if (input.slug && !wanted) {
      throw new BadRequestException(
        'A slug is lower-case letters, digits and dashes'
      );
    }
    // The author's own skills come along into My skills; the skill links
    // and the index then name the copies. Planned first, written with the
    // flow once everything is known to be valid.
    const plan = await this._userSkills.planImport(
      organizationId,
      share.id,
      ownSkills || []
    );
    const relink = <T extends string | undefined>(value: T): T =>
      (typeof value === 'string'
        ? value.replace(
            SKILL_CHIP,
            (link: string, label: string, reference: string) =>
              plan.references[reference]
                ? `[Skill: ${label}](skill:${plan.references[reference]})`
                : link
          )
        : value) as T;
    const parts = flow.parts
      ? Object.fromEntries(
          Object.entries(flow.parts).map(([key, one]) => [key, relink(one)])
        )
      : flow.parts;
    const limits = importLimits({
      body: relink(flow.body),
      customization: relink(flow.customization),
      parts,
      skills: flow.skills.map((one) => plan.references[one] || one),
    });
    const title = text(input.title, USER_FLOW_TITLE_MAX) || flow.title;
    const data = toData({
      title,
      whenToUse: flow.whenToUse,
      summary: flow.summary,
      body: relink(flow.body),
      parts,
      category: flow.category,
      cost: flow.cost,
      foundation: flow.foundation,
      brandSlots: flow.brandSlots,
      basedOn: flow.basedOn,
      customization: limits.customization,
      skills: limits.skills,
    });
    const warnings = [
      ...scrubbed,
      ...share.warnings,
      ...limits.warnings,
      ...plan.warnings,
    ];
    const slug = await this.freeSlug(
      organizationId,
      wanted || slugify(title)
    );
    await this._flows.importFlow(
      organizationId,
      slug,
      forDb(data) as UserFlowData,
      share.id,
      plan.create
    );
    return { slug, created: true, warnings };
  }

  // A live share and its flow as shared: a custom flow based on My flows is
  // merged with them (flatten), so the link carries no slug of the author's.
  private async liveShare(token: string) {
    const key = text(token, USER_FLOW_TOKEN_MAX);
    const share = key ? await this._flows.shared(key) : null;
    const gone = new NotFoundException(
      'This share link was turned off or never existed'
    );
    if (!share) {
      throw gone;
    }
    const read = (slug: string) =>
      this._flows.base(share.organizationId, slug);
    // A link to a copy of a library flow opens nothing, whenever it was made.
    if (await this.holdsLibrary(share.organizationId, share.userFlow, read)) {
      throw gone;
    }
    const found = await this.ancestors(share.userFlow, read);
    const { source, forkedFromId, slug, ...userFlow } = share.userFlow;
    const flat = flatten(share.userFlow, found.chain);
    return {
      ...share,
      userFlow: { ...userFlow, ...flat },
      ownSkills: await this.ownSkillsOf(share.organizationId, flat.skills),
      warnings: chainWarnings(found, share.userFlow, false),
    };
  }

  // The flows of this workspace a flow is based on, nearest first, following
  // "my/<slug>" bases up to a library flow, a flow of its own, a base that is
  // gone, a loop or USER_FLOW_CHAIN_MAX flows.
  private async ancestors<T extends { slug: string; basedOn: string | null }>(
    flow: { slug?: string; basedOn?: string | null },
    read: (slug: string) => Promise<T | null>
  ): Promise<Ancestors<T>> {
    const chain: T[] = [];
    const seen = new Set(flow.slug ? [flow.slug] : []);
    let next = flow.basedOn;
    while (next?.startsWith(MY)) {
      const slug = next.slice(MY.length);
      if (seen.has(slug)) {
        return { chain, cycle: true };
      }
      if (chain.length >= USER_FLOW_CHAIN_MAX) {
        return { chain, tooDeep: true };
      }
      const row = await read(slug);
      if (!row) {
        return { chain, broken: slug };
      }
      seen.add(slug);
      chain.push(row);
      next = row.basedOn;
    }
    return { chain };
  }

  // The base and skills a save writes, checked: a base among My flows exists,
  // is not the flow itself and does not lead back to it, no chain through it
  // (its own, or one of a flow based on it) runs past USER_FLOW_CHAIN_MAX,
  // every skill slug is in the skills library and every "my/<slug>" is one
  // of My skills. Only the skills the flow did not bring in before are
  // checked: one it already did that is gone since (shown as missing) does
  // not stop an edit. A library base is checked for its form only: the
  // library is read through the gateway.
  private async checkReferences(
    organizationId: string,
    slug: string | undefined,
    data: CleanFlow,
    storedSkills: string[] = []
  ) {
    if (data.basedOn?.startsWith(MY)) {
      const itself = new BadRequestException(
        'A flow cannot be based on itself.'
      );
      if (slug && data.basedOn === `${MY}${slug}`) {
        throw itself;
      }
      const { chain, cycle, tooDeep } = await this.ancestors(
        { slug, basedOn: data.basedOn },
        (base) => this._flows.base(organizationId, base)
      );
      if (cycle) {
        throw itself;
      }
      if (!chain.length) {
        throw new BadRequestException(
          `There is no flow named "${data.basedOn}" to base on.`
        );
      }
      // The flows based on this one sit that many links further down.
      const below = slug ? await this.levelsBelow(organizationId, slug) : 0;
      if (tooDeep || chain.length + below > USER_FLOW_CHAIN_MAX) {
        throw new BadRequestException(
          `A flow can be based on a chain of at most ${USER_FLOW_CHAIN_MAX} of My flows.`
        );
      }
    }
    const added = (data.skills || []).filter(
      (one) => !storedSkills.includes(one)
    );
    const library = added.filter((one) => !one.startsWith(MY_SKILL));
    if (library.length) {
      const known = new Set(
        (await this._skills.bySlugs(library)).map((one) => one.slug)
      );
      const unknown = library.find((one) => !known.has(one));
      if (unknown) {
        throw new BadRequestException(
          `There is no skill named "${unknown}" in the skills library.`
        );
      }
    }
    const mine = added.filter((one) => one.startsWith(MY_SKILL));
    if (mine.length) {
      const known = new Set(
        (
          await this._userSkills.bySlugs(
            organizationId,
            mine.map((one) => one.slice(MY_SKILL.length))
          )
        ).map((one) => `${MY_SKILL}${one.slug}`)
      );
      const unknown = mine.find((one) => !known.has(one));
      if (unknown) {
        const all = (await this._userSkills.list(organizationId)).map(
          (one) => `${MY_SKILL}${one.slug}`
        );
        throw new BadRequestException(
          `There is no skill named "${unknown}" in My skills. ${
            all.length ? `My skills: ${all.join(', ')}.` : 'My skills is empty.'
          }`
        );
      }
    }
  }

  // How many links of live flows hang below one of My flows: 0 when none is
  // based on it, 1 when only direct ones are, and so on. Stops past
  // USER_FLOW_CHAIN_MAX, and never visits a flow twice.
  private async levelsBelow(organizationId: string, slug: string) {
    const seen = new Set([slug]);
    let level = [slug];
    let levels = 0;
    while (level.length && levels <= USER_FLOW_CHAIN_MAX) {
      const next: string[] = [];
      for (const one of level) {
        for (const dependent of await this._flows.dependents(
          organizationId,
          one
        )) {
          if (!seen.has(dependent.slug)) {
            seen.add(dependent.slug);
            next.push(dependent.slug);
          }
        }
      }
      if (!next.length) {
        break;
      }
      levels++;
      level = next;
    }
    return levels;
  }

  // The skills a flow brings in, in its order: the skills library's (locked
  // without the skills unlock) and this workspace's own (never locked).
  private async skillsOf(
    organizationId: string,
    slugs: string[],
    unlocked: boolean
  ): Promise<FlowSkill[]> {
    if (!slugs.length) {
      return [];
    }
    const library = slugs.filter((one) => !one.startsWith(MY_SKILL));
    const mine = slugs.filter((one) => one.startsWith(MY_SKILL));
    const found = new Map(
      (library.length ? await this._skills.bySlugs(library) : []).map(
        (one) => [one.slug, one]
      )
    );
    const own = new Map(
      (mine.length
        ? await this._userSkills.bySlugs(
            organizationId,
            mine.map((one) => one.slice(MY_SKILL.length))
          )
        : []
      ).map((one) => [`${MY_SKILL}${one.slug}`, one])
    );
    return slugs.map((slug): FlowSkill => {
      if (slug.startsWith(MY_SKILL)) {
        const skill = own.get(slug);
        return skill
          ? {
              slug,
              kind: 'mine',
              name: skill.name,
              summary: skill.description,
              whenToUse: null,
              body: skill.body,
            }
          : {
              slug,
              kind: 'mine',
              name: slug,
              summary: '',
              whenToUse: null,
              missing: true,
            };
      }
      const skill = found.get(slug);
      if (!skill) {
        return {
          slug,
          kind: 'voho',
          name: slug,
          summary: '',
          whenToUse: null,
          missing: true,
        };
      }
      return {
        slug,
        kind: 'voho',
        name: skill.name,
        summary: skill.summary,
        whenToUse: skill.whenToUse,
        ...(unlocked ? { body: skill.body } : { locked: true as const }),
      };
    });
  }

  // The skills of the author's My skills a shared flow brings in, whole,
  // for the import to copy: the ones that still exist, at most
  // USER_FLOW_SKILLS_MAX.
  private async ownSkillsOf(
    organizationId: string,
    slugs: string[]
  ): Promise<SharedUserSkill[]> {
    const mine = slugs
      .filter((one) => one.startsWith(MY_SKILL))
      .slice(0, USER_FLOW_SKILLS_MAX);
    if (!mine.length) {
      return [];
    }
    const found = new Map(
      (
        await this._userSkills.bySlugs(
          organizationId,
          mine.map((one) => one.slice(MY_SKILL.length))
        )
      ).map((one) => [`${MY_SKILL}${one.slug}`, one])
    );
    return mine.flatMap((slug) => {
      const skill = found.get(slug);
      return skill
        ? [
            {
              slug,
              name: skill.name,
              description: skill.description,
              body: skill.body,
            },
          ]
        : [];
    });
  }

  // Whether a flow holds Voho's method: it is a copy of a library flow
  // (fromLibrary), or one of My flows it is based on is. A flow based on a
  // library flow by id holds only its own changes, so it is not.
  private async holdsLibrary(
    organizationId: string,
    flow: LibraryLink,
    read: (slug: string) => Promise<LibraryLink | null>,
    depth = 0
  ): Promise<boolean> {
    if (await this.fromLibrary(organizationId, flow, depth)) {
      return true;
    }
    const { chain } = await this.ancestors(flow, read);
    for (const link of chain) {
      if (await this.fromLibrary(organizationId, link, depth)) {
        return true;
      }
    }
    return false;
  }

  // Whether a flow is a copy of a Voho library flow: forked from one, or
  // forked from a flow of this workspace that holds one (a copy itself, or
  // based on one through My flows). Its method is Voho's, so it is never
  // shared (a share link opens to anyone signed in to Studio).
  private async fromLibrary(
    organizationId: string,
    flow: { source: FlowSource; forkedFromId: string | null },
    depth = 0
  ): Promise<boolean> {
    if (flow.source !== 'FORKED' || !flow.forkedFromId) {
      return false;
    }
    if (!flow.forkedFromId.startsWith(MY) || depth >= 5) {
      return true;
    }
    const parent = await this._flows.origin(
      organizationId,
      flow.forkedFromId.slice(MY.length)
    );
    return (
      !!parent &&
      this.holdsLibrary(
        organizationId,
        parent,
        (slug) => this._flows.origin(organizationId, slug),
        depth + 1
      )
    );
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
    return nextFreeSlug(base, taken);
  }
}
