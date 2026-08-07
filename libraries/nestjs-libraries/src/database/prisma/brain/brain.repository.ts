import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class BrainRepository {
  constructor(private _brain: PrismaRepository<'agentBrainDocument'>) {}

  getDocuments(orgId: string) {
    return this._brain.model.agentBrainDocument.findMany({
      where: { organizationId: orgId },
    });
  }

  countDocuments(orgId: string, category: string) {
    return this._brain.model.agentBrainDocument.count({
      where: { organizationId: orgId, category },
    });
  }

  getDocument(orgId: string, category: string, key: string) {
    return this._brain.model.agentBrainDocument.findUnique({
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
      return await this._brain.model.agentBrainDocument.upsert({
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

      return this._brain.model.agentBrainDocument.update({
        where,
        data: { content },
      });
    }
  }

  // deleteMany rather than delete: clearing a document that was never saved is a
  // no-op, not an error.
  deleteDocument(orgId: string, category: string, key: string) {
    return this._brain.model.agentBrainDocument.deleteMany({
      where: { organizationId: orgId, category, key },
    });
  }
}
