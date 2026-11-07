import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// What a list of My skills shows: no body.
const listFields = {
  slug: true,
  name: true,
  description: true,
  updatedAt: true,
} satisfies Prisma.UserSkillSelect;

// One skill whole.
const skillFields = {
  ...listFields,
  body: true,
} satisfies Prisma.UserSkillSelect;

export type UserSkillData = Pick<
  Prisma.UserSkillUncheckedCreateInput,
  'name' | 'description' | 'body'
>;

// A workspace's own skills. Deleted skills stay as rows (deletedAt) and are
// never returned.
@Injectable()
export class UserSkillsRepository {
  constructor(
    private _skill: PrismaRepository<'userSkill'>,
    private _flow: PrismaRepository<'userFlow'>
  ) {}

  list(organizationId: string) {
    return this._skill.model.userSkill.findMany({
      where: { organizationId, deletedAt: null },
      select: listFields,
      orderBy: { updatedAt: 'desc' },
    });
  }

  get(organizationId: string, slug: string) {
    return this._skill.model.userSkill.findFirst({
      where: { organizationId, slug, deletedAt: null },
      select: skillFields,
    });
  }

  // The live skills among these slugs, whole: what a flow that brings them
  // in reads.
  bySlugs(organizationId: string, slugs: string[]) {
    return this._skill.model.userSkill.findMany({
      where: { organizationId, slug: { in: slugs }, deletedAt: null },
      select: skillFields,
    });
  }

  countLive(organizationId: string) {
    return this._skill.model.userSkill.count({
      where: { organizationId, deletedAt: null },
    });
  }

  // The row behind a slug, deleted or not: slugs stay unique per workspace
  // across deleted rows, so a deleted slug is never handed out again.
  slugRow(organizationId: string, slug: string) {
    return this._skill.model.userSkill.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
      select: { id: true, deletedAt: true },
    });
  }

  // The slugs in use that start with this one, for picking a free one.
  slugsLike(organizationId: string, slug: string) {
    return this._skill.model.userSkill.findMany({
      where: { organizationId, slug: { startsWith: slug } },
      select: { slug: true },
    });
  }

  // The live skills copied with flows imported from one share link.
  importedCopies(organizationId: string, importedShareId: string) {
    return this._skill.model.userSkill.findMany({
      where: { organizationId, importedShareId, deletedAt: null },
      select: { slug: true, name: true },
    });
  }

  // The live flows that bring in a skill ("my/<slug>").
  flowsUsing(organizationId: string, reference: string) {
    return this._flow.model.userFlow.findMany({
      where: { organizationId, deletedAt: null, skills: { has: reference } },
      select: { slug: true },
    });
  }

  create(
    organizationId: string,
    slug: string,
    data: UserSkillData &
      Pick<Prisma.UserSkillUncheckedCreateInput, 'importedShareId'>
  ) {
    return this._skill.model.userSkill.create({
      data: { ...data, organizationId, slug },
      select: skillFields,
    });
  }

  update(id: string, data: Partial<UserSkillData>) {
    return this._skill.model.userSkill.update({
      where: { id },
      data,
      select: skillFields,
    });
  }

  softDelete(id: string) {
    return this._skill.model.userSkill.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }
}
