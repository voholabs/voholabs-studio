import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class HermesRepository {
  constructor(
    private _organization: PrismaRepository<'organization'>,
    private _conversation: PrismaRepository<'hermesConversation'>
  ) {}

  getOrganization(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: orgId },
      select: { id: true, hermesUrl: true, hermesApiKey: true },
    });
  }

  setHermes(
    orgId: string,
    data: { hermesUrl?: string | null; hermesApiKey?: string | null }
  ) {
    return this._organization.model.organization.update({
      where: { id: orgId },
      data,
    });
  }

  // The list never carries the messages: it is a sidebar, not a transcript.
  getConversations(orgId: string) {
    return this._conversation.model.hermesConversation.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true },
      take: 100,
    });
  }

  getConversation(orgId: string, id: string) {
    return this._conversation.model.hermesConversation.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  createConversation(orgId: string, title: string, messages: string) {
    return this._conversation.model.hermesConversation.create({
      data: { organizationId: orgId, title, messages },
    });
  }

  updateConversation(
    orgId: string,
    id: string,
    data: { title?: string; messages?: string }
  ) {
    return this._conversation.model.hermesConversation.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
  }

  deleteConversation(orgId: string, id: string) {
    return this._conversation.model.hermesConversation.deleteMany({
      where: { id, organizationId: orgId },
    });
  }
}
