import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// What a list of flows shows: no body or parts.
const listFields = {
  id: true,
  slug: true,
  title: true,
  whenToUse: true,
  summary: true,
  category: true,
  cost: true,
  foundation: true,
  source: true,
  // Read for the "shareable" check only; not returned by the service.
  forkedFromId: true,
  basedOn: true,
  skills: true,
  poster: true,
  updatedAt: true,
  shares: {
    where: { revokedAt: null },
    select: { token: true },
    take: 1,
  },
} satisfies Prisma.UserFlowSelect;

// One flow whole: what workflowGet and the editor read.
const flowFields = {
  id: true,
  slug: true,
  title: true,
  whenToUse: true,
  summary: true,
  category: true,
  cost: true,
  foundation: true,
  body: true,
  parts: true,
  brandSlots: true,
  source: true,
  forkedFromId: true,
  basedOn: true,
  customization: true,
  skills: true,
  poster: true,
  exampleVideo: true,
  version: true,
  updatedAt: true,
  shares: {
    where: { revokedAt: null },
    select: { token: true },
    take: 1,
  },
} satisfies Prisma.UserFlowSelect;

// What a flow adds to the ones based on it, read while following a chain of
// bases: its method, where it comes from and its own base.
const baseFields = {
  slug: true,
  title: true,
  basedOn: true,
  customization: true,
  skills: true,
  body: true,
  parts: true,
  cost: true,
  foundation: true,
  source: true,
  forkedFromId: true,
} satisfies Prisma.UserFlowSelect;

export type UserFlowData = Pick<
  Prisma.UserFlowUncheckedCreateInput,
  | 'title'
  | 'whenToUse'
  | 'summary'
  | 'category'
  | 'cost'
  | 'foundation'
  | 'body'
  | 'parts'
  | 'brandSlots'
  | 'poster'
  | 'exampleVideo'
  | 'basedOn'
  | 'customization'
  | 'skills'
>;

// A workspace's own flows and their share links. Deleted flows stay as rows
// (deletedAt) and are never returned.
@Injectable()
export class UserFlowsRepository {
  constructor(
    private _flow: PrismaRepository<'userFlow'>,
    private _share: PrismaRepository<'flowShare'>,
    private _transaction: PrismaTransaction
  ) {}

  list(organizationId: string) {
    return this._flow.model.userFlow.findMany({
      where: { organizationId, deletedAt: null },
      select: listFields,
      orderBy: { updatedAt: 'desc' },
    });
  }

  get(organizationId: string, slug: string) {
    return this._flow.model.userFlow.findFirst({
      where: { organizationId, slug, deletedAt: null },
      select: flowFields,
    });
  }

  // The row behind a slug, deleted or not: slugs stay unique per workspace
  // across deleted rows, so a deleted slug is never handed out again.
  slugRow(organizationId: string, slug: string) {
    return this._flow.model.userFlow.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
      select: { id: true, deletedAt: true },
    });
  }

  // Where the flow behind a slug came from, deleted or not: for following a
  // fork (or a base) back to the Voho library.
  origin(organizationId: string, slug: string) {
    return this._flow.model.userFlow.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
      select: { slug: true, basedOn: true, source: true, forkedFromId: true },
    });
  }

  // A live flow as a base of another: what the flows based on it read.
  base(organizationId: string, slug: string) {
    return this._flow.model.userFlow.findFirst({
      where: { organizationId, slug, deletedAt: null },
      select: baseFields,
    });
  }

  // The live flows based on one of this workspace's flows ("my/<slug>").
  dependents(organizationId: string, slug: string) {
    return this._flow.model.userFlow.findMany({
      where: { organizationId, deletedAt: null, basedOn: `my/${slug}` },
      select: { slug: true, title: true },
    });
  }

  // The slugs in use that start with this one, for picking a free one.
  slugsLike(organizationId: string, slug: string) {
    return this._flow.model.userFlow.findMany({
      where: { organizationId, slug: { startsWith: slug } },
      select: { slug: true },
    });
  }

  create(
    organizationId: string,
    slug: string,
    data: UserFlowData &
      Pick<
        Prisma.UserFlowUncheckedCreateInput,
        'source' | 'forkedFromId' | 'importedShareId'
      >
  ) {
    return this._flow.model.userFlow.create({
      data: { ...data, organizationId, slug },
      select: { id: true, slug: true },
    });
  }

  // An edit: the fields given change and the version moves on.
  update(id: string, data: Partial<UserFlowData>) {
    return this._flow.model.userFlow.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
      select: { id: true, slug: true },
    });
  }

  softDelete(id: string) {
    return this._flow.model.userFlow.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  activeShare(userFlowId: string) {
    return this._share.model.flowShare.findFirst({
      where: { userFlowId, revokedAt: null },
      select: { token: true },
    });
  }

  createShare(organizationId: string, userFlowId: string, token: string) {
    return this._share.model.flowShare.create({
      data: { organizationId, userFlowId, token },
      select: { token: true },
    });
  }

  revokeShares(userFlowId: string) {
    return this._share.model.flowShare.updateMany({
      where: { userFlowId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // A live share and the method fields of its flow (with its slug and base,
  // to follow a chain of bases); null when the link was revoked or the flow
  // deleted.
  shared(token: string) {
    return this._share.model.flowShare.findFirst({
      where: {
        token,
        revokedAt: null,
        userFlow: { deletedAt: null },
      },
      select: {
        id: true,
        organizationId: true,
        userFlow: {
          select: {
            slug: true,
            source: true,
            forkedFromId: true,
            basedOn: true,
            customization: true,
            skills: true,
            title: true,
            whenToUse: true,
            summary: true,
            category: true,
            cost: true,
            foundation: true,
            body: true,
            parts: true,
            brandSlots: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  // An import, all or nothing: the copies of the author's own skills into
  // My skills, the flow, and the share's import count.
  importFlow(
    organizationId: string,
    slug: string,
    data: UserFlowData,
    shareId: string,
    skills: Array<
      Pick<
        Prisma.UserSkillUncheckedCreateInput,
        'slug' | 'name' | 'description' | 'body'
      >
    >
  ) {
    return this._transaction.model.$transaction(async (tx) => {
      for (const skill of skills) {
        await tx.userSkill.create({
          data: { ...skill, organizationId, importedShareId: shareId },
          select: { id: true },
        });
      }
      const flow = await tx.userFlow.create({
        data: {
          ...data,
          organizationId,
          slug,
          source: 'IMPORTED',
          forkedFromId: null,
          importedShareId: shareId,
        },
        select: { id: true, slug: true },
      });
      await tx.flowShare.update({
        where: { id: shareId },
        data: { imports: { increment: 1 } },
        select: { id: true },
      });
      return flow;
    });
  }
}
