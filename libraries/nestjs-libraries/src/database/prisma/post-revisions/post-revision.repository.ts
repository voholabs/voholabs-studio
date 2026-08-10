import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  Prisma,
  PostRevision,
  RevisionLearnedOutcome,
} from '@prisma/client';

@Injectable()
export class PostRevisionRepository {
  constructor(private _postRevision: PrismaRepository<'postRevision'>) {}

  // The chain a save belongs to is found from the post rows it wrote, because
  // those ids survive an edit. Group is the fallback for the case where every
  // row of a thread was replaced.
  findChainByPostIds(orgId: string, postIds: string[]) {
    if (!postIds.length) {
      return null;
    }

    return this._postRevision.model.postRevision.findFirst({
      where: { organizationId: orgId, postIds: { hasSome: postIds } },
      orderBy: { updatedAt: 'desc' },
      select: { chainId: true },
    });
  }

  findChainByGroup(orgId: string, group?: string) {
    if (!group) {
      return null;
    }

    return this._postRevision.model.postRevision.findFirst({
      where: { organizationId: orgId, group },
      orderBy: { updatedAt: 'desc' },
      select: { chainId: true },
    });
  }

  getChain(orgId: string, chainId: string) {
    return this._postRevision.model.postRevision.findMany({
      where: { organizationId: orgId, chainId },
    });
  }

  create(data: Prisma.PostRevisionUncheckedCreateInput) {
    return this._postRevision.model.postRevision.create({ data });
  }

  // Every save mints a new group, so a chain whose snapshot did not change
  // still has to be told where it now lives, or the next save cannot find it.
  refreshLinking(id: string, group: string, postIds: string[]) {
    return this._postRevision.model.postRevision.update({
      where: { id },
      data: { group, postIds },
    });
  }

  async upsertFinal(
    orgId: string,
    chainId: string,
    data: Omit<
      Prisma.PostRevisionUncheckedCreateInput,
      'organizationId' | 'chainId' | 'kind'
    >
  ) {
    const where = { chainId_kind: { chainId, kind: 'FINAL' as const } };

    try {
      return await this._postRevision.model.postRevision.upsert({
        where,
        update: data,
        create: {
          ...data,
          organizationId: orgId,
          chainId,
          kind: 'FINAL',
        },
      });
    } catch (err) {
      // upsert is not atomic, so two saves landing together can both take the
      // create branch.
      if ((err as { code?: string })?.code !== 'P2002') {
        throw err;
      }

      return this._postRevision.model.postRevision.update({
        where,
        data,
      });
    }
  }

  stampPublished(id: string, publishedAt: Date) {
    return this._postRevision.model.postRevision.update({
      where: { id },
      data: { publishedAt },
    });
  }

  deleteChain(orgId: string, chainId: string) {
    return this._postRevision.model.postRevision.deleteMany({
      where: { organizationId: orgId, chainId },
    });
  }

  // The review queue: posts that actually went out, carrying changes made after
  // they were drafted, that have not been learned from yet.
  getQueue(
    orgId: string,
    options: { limit: number; includeLearned: boolean }
  ): Promise<PostRevision[]> {
    return this._postRevision.model.postRevision.findMany({
      where: {
        organizationId: orgId,
        kind: 'FINAL',
        publishedAt: { not: null },
        changed: true,
        ...(options.includeLearned ? {} : { learnedAt: null }),
      },
      orderBy: { publishedAt: 'desc' },
      take: options.limit,
    });
  }

  getRevisionsByChainIds(orgId: string, chainIds: string[]) {
    return this._postRevision.model.postRevision.findMany({
      where: { organizationId: orgId, chainId: { in: chainIds } },
    });
  }

  markLearned(
    orgId: string,
    chainIds: string[],
    outcome: RevisionLearnedOutcome,
    topic?: string
  ) {
    return this._postRevision.model.postRevision.updateMany({
      where: {
        organizationId: orgId,
        chainId: { in: chainIds },
        kind: 'FINAL',
        // A chain that never went out has no "what actually happened" to learn
        // from, so it cannot be marked.
        publishedAt: { not: null },
      },
      data: {
        learnedAt: new Date(),
        learnedOutcome: outcome,
        learnedTopic: topic ?? null,
      },
    });
  }
}
