import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

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
>;

// A workspace's own flows and their share links. Deleted flows stay as rows
// (deletedAt) and are never returned.
@Injectable()
export class UserFlowsRepository {
  constructor(
    private _flow: PrismaRepository<'userFlow'>,
    private _share: PrismaRepository<'flowShare'>
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
  // fork back to the Voho library.
  origin(organizationId: string, slug: string) {
    return this._flow.model.userFlow.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
      select: { source: true, forkedFromId: true },
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

  // A live share and the method fields of its flow; null when the link was
  // revoked or the flow deleted.
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
            source: true,
            forkedFromId: true,
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

  countImport(shareId: string) {
    return this._share.model.flowShare.update({
      where: { id: shareId },
      data: { imports: { increment: 1 } },
      select: { id: true },
    });
  }
}
