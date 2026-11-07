import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  UserSkillData,
  UserSkillsRepository,
} from '@gitroom/nestjs-libraries/database/prisma/user-skills/user-skills.repository';
import {
  nextFreeSlug,
  slugify,
} from '@gitroom/nestjs-libraries/database/prisma/user-flows/user-flows.slug';
import {
  USER_FLOW_SLUG,
  USER_FLOW_SLUG_MAX,
  USER_SKILL_BODY_MAX,
  USER_SKILL_DESCRIPTION_MAX,
  USER_SKILL_NAME_MAX,
  USER_SKILLS_MAX,
} from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

// The fields a skill is written with, from the app or an import.
export interface UserSkillInput {
  name?: string;
  description?: string;
  body?: string;
}

// A skill as a share link carries it: "slug" is its reference ("my/<slug>").
export interface SharedUserSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
}

// How a skill link names one of My skills.
export const MY_SKILL = 'my/';

// A SKILL.md opens with a front matter block ("---" lines around name: and
// description:); the instructions are what follows it.
const FRONT_MATTER = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
export const stripFrontMatter = (text: string) =>
  text.replace(FRONT_MATTER, '');

const MY_SKILLS_FULL = `My skills holds at most ${USER_SKILLS_MAX} skills. Delete one to add another.`;

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : undefined;

const validSlug = (slug: string) => {
  const key = (slug || '').trim().toLowerCase();
  return key.length <= USER_FLOW_SLUG_MAX && USER_FLOW_SLUG.test(key)
    ? key
    : undefined;
};

// The writable fields of an input, cleaned; a field left out stays undefined
// so an edit keeps what is stored.
const toData = (input: UserSkillInput): Partial<UserSkillData> => {
  const body =
    typeof input.body === 'string'
      ? stripFrontMatter(input.body).trim()
      : undefined;
  if (body !== undefined && body.length > USER_SKILL_BODY_MAX) {
    throw new BadRequestException(
      `The skill is too long: at most ${USER_SKILL_BODY_MAX.toLocaleString(
        'en-US'
      )} characters.`
    );
  }
  const name = text(input.name, USER_SKILL_NAME_MAX);
  if (name === '') {
    throw new BadRequestException('A skill needs a name.');
  }
  const data: Partial<UserSkillData> = {
    name,
    description: text(input.description, USER_SKILL_DESCRIPTION_MAX),
    body,
  };
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<UserSkillData>;
};

// A workspace's own skills ("My skills"): Markdown instructions its flows
// bring in with a skill link to "my/<slug>". Written in the app (or copied
// with an imported flow); there is no MCP tool that writes them. A skill a
// flow brings in stays until the flow no longer does.
@Injectable()
export class UserSkillsService {
  constructor(private _skills: UserSkillsRepository) {}

  list(organizationId: string) {
    return this._skills.list(organizationId);
  }

  async get(organizationId: string, slug: string) {
    const key = validSlug(slug);
    return key ? this._skills.get(organizationId, key) : null;
  }

  // The live skills among these slugs (without "my/"); an unknown or
  // deleted one is left out.
  bySlugs(organizationId: string, slugs: string[]) {
    const keys = [
      ...new Set(slugs.map(validSlug).filter(Boolean)),
    ] as string[];
    return keys.length
      ? this._skills.bySlugs(organizationId, keys)
      : Promise.resolve([]);
  }

  async create(
    organizationId: string,
    input: UserSkillInput,
    importedShareId: string | null = null
  ) {
    const data = toData(input);
    if (!data.name) {
      throw new BadRequestException('A skill needs a name.');
    }
    if ((await this._skills.countLive(organizationId)) >= USER_SKILLS_MAX) {
      throw new BadRequestException(MY_SKILLS_FULL);
    }
    const slug = await this.freeSlug(
      organizationId,
      slugify(data.name, 'skill')
    );
    return this._skills.create(organizationId, slug, {
      name: data.name,
      description: data.description || '',
      body: data.body || '',
      importedShareId,
    });
  }

  // An edit: only the fields given change. The slug stays, so the skill
  // links to it keep working after a rename.
  async update(organizationId: string, slug: string, input: UserSkillInput) {
    const skill = await this.existing(organizationId, slug);
    return this._skills.update(skill.id, toData(input));
  }

  // Refused while a live flow brings the skill in.
  async delete(organizationId: string, slug: string) {
    const skill = await this.existing(organizationId, slug);
    const using = await this._skills.flowsUsing(
      organizationId,
      `${MY_SKILL}${skill.slug}`
    );
    if (using.length) {
      const names = using.map((one) => `my/${one.slug}`).join(', ');
      throw new BadRequestException(
        using.length === 1
          ? `1 flow uses this skill (${names}). Remove it from that flow first.`
          : `${using.length} flows use this skill (${names}). Remove it from them first.`
      );
    }
    await this._skills.softDelete(skill.id);
    return { deleted: true };
  }

  // The skills a shared flow brings with it, copied into this workspace's
  // My skills (each under a free slug). Returns the reference each one has
  // here, by its reference in the shared flow, and the warnings: a copy
  // under another slug, or one My skills had no room for (its reference here
  // then names no skill, so the flow runs without it).
  async importCopies(
    organizationId: string,
    shareId: string,
    skills: SharedUserSkill[]
  ) {
    const references: Record<string, string> = {};
    const warnings: string[] = [];
    let live = await this._skills.countLive(organizationId);
    for (const skill of skills) {
      const wanted =
        validSlug(skill.slug.slice(MY_SKILL.length)) ||
        slugify(skill.name, 'skill');
      if (live >= USER_SKILLS_MAX) {
        const slug = await this.freeSlug(organizationId, wanted);
        references[skill.slug] = `${MY_SKILL}${slug}`;
        warnings.push(
          `My skills holds at most ${USER_SKILLS_MAX} skills, so "${skill.name}" was not copied; the flow runs without it.`
        );
        continue;
      }
      // The scrub may have emptied the name or lengthened the body.
      const data = toData({
        name: skill.name.trim() || wanted,
        description: skill.description,
        body: stripFrontMatter(skill.body).slice(0, USER_SKILL_BODY_MAX),
      });
      const slug = await this.freeSlug(organizationId, wanted);
      await this._skills.create(organizationId, slug, {
        name: data.name || wanted,
        description: data.description || '',
        body: data.body || '',
        importedShareId: shareId,
      });
      live++;
      references[skill.slug] = `${MY_SKILL}${slug}`;
      if (slug !== wanted) {
        warnings.push(
          `The skill "${skill.name}" is saved in My skills as "${MY_SKILL}${slug}", since "${MY_SKILL}${wanted}" was taken.`
        );
      }
    }
    return { references, warnings };
  }

  private async existing(organizationId: string, slug: string) {
    const key = validSlug(slug);
    const row = key ? await this._skills.slugRow(organizationId, key) : null;
    if (!key || !row || row.deletedAt) {
      throw new NotFoundException('Skill not found');
    }
    return { id: row.id, slug: key };
  }

  // A slug nothing (not even a deleted skill) has.
  private async freeSlug(organizationId: string, slug: string) {
    const taken = new Set(
      (await this._skills.slugsLike(organizationId, slug)).map(
        (row) => row.slug
      )
    );
    return nextFreeSlug(slug, taken);
  }
}
