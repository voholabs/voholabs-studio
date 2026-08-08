import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class BriefRepository {
  constructor(private _brief: PrismaRepository<'agentBriefDocument'>) {}

  getDocuments(orgId: string) {
    return this._brief.model.agentBriefDocument.findMany({
      where: { organizationId: orgId },
    });
  }

  countDocuments(orgId: string, category: string) {
    return this._brief.model.agentBriefDocument.count({
      where: { organizationId: orgId, category },
    });
  }

  getDocument(orgId: string, category: string, key: string) {
    return this._brief.model.agentBriefDocument.findUnique({
      where: {
        organizationId_category_key: {
          organizationId: orgId,
          category,
          key,
        },
      },
    });
  }

  async saveDocument(
    orgId: string,
    category: string,
    key: string,
    content: string
  ) {
    const where = {
      organizationId_category_key: {
        organizationId: orgId,
        category,
        key,
      },
    };

    try {
      return await this._brief.model.agentBriefDocument.upsert({
        where,
        update: { content },
        create: { organizationId: orgId, category, key, content },
      });
    } catch (err) {
      // upsert is not atomic against a concurrent insert, so two tabs saving a
      // document that does not exist yet can both take the create branch.
      if ((err as { code?: string })?.code !== 'P2002') {
        throw err;
      }

      return this._brief.model.agentBriefDocument.update({
        where,
        data: { content },
      });
    }
  }

  // deleteMany rather than delete: clearing a document that was never saved is a
  // no-op, not an error.
  deleteDocument(orgId: string, category: string, key: string) {
    return this._brief.model.agentBriefDocument.deleteMany({
      where: { organizationId: orgId, category, key },
    });
  }
}
