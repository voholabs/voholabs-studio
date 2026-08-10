import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Prisma, RevisionLearnedOutcome } from '@prisma/client';

@Injectable()
export class BriefRevisionRepository {
  constructor(private _briefRevision: PrismaRepository<'briefRevision'>) {}

  // Newest first: the reader always wants the current state and the point it
  // last diverged, both of which are at the top.
  getRevisions(orgId: string, category: string, key: string, take = 20) {
    return this._briefRevision.model.briefRevision.findMany({
      where: { organizationId: orgId, category, key },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  getLatestPerDocument(orgId: string) {
    return this._briefRevision.model.briefRevision.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: Prisma.BriefRevisionUncheckedCreateInput) {
    return this._briefRevision.model.briefRevision.create({ data });
  }

  // Keeps the log from growing without bound. Deleting by id rather than by
  // date avoids a race with a revision written in between.
  deleteByIds(ids: string[]) {
    return this._briefRevision.model.briefRevision.deleteMany({
      where: { id: { in: ids } },
    });
  }

  deleteDocument(orgId: string, category: string, key: string) {
    return this._briefRevision.model.briefRevision.deleteMany({
      where: { organizationId: orgId, category, key },
    });
  }

  markLearned(id: string, outcome: RevisionLearnedOutcome) {
    return this._briefRevision.model.briefRevision.update({
      where: { id },
      data: { learnedAt: new Date(), learnedOutcome: outcome },
    });
  }
}
