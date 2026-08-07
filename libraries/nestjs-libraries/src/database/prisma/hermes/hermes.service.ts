import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { HermesRepository } from '@gitroom/nestjs-libraries/database/prisma/hermes/hermes.repository';
import { HermesMessageDto } from '@gitroom/nestjs-libraries/dtos/hermes/hermes.dto';

const COMPLETIONS_PATH = '/chat/completions';

// One Hermes agent per organization, shared by everyone on the team.
@Injectable()
export class HermesService {
  constructor(private _hermesRepository: HermesRepository) {}

  // Neither the URL nor the key is ever returned — only whether the team has an
  // agent connected.
  async getSettings(orgId: string) {
    const organization = await this._hermesRepository.getOrganization(orgId);

    return {
      configured: !!organization?.hermesUrl && !!organization?.hermesApiKey,
    };
  }

  async setSettings(
    orgId: string,
    body: { url?: string; apiKey?: string }
  ) {
    if (body.url) {
      this.assertHttpUrl(body.url);
    }

    await this._hermesRepository.setHermes(orgId, {
      ...(body.url !== undefined ? { hermesUrl: body.url || null } : {}),
      // An omitted key leaves the stored one alone; an empty string clears it.
      ...(body.apiKey
        ? { hermesApiKey: AuthService.fixedEncryption(body.apiKey) }
        : {}),
      ...(body.apiKey === '' ? { hermesApiKey: null } : {}),
    });

    return { saved: true };
  }

  // Calls the team's agent and hands the raw upstream response back, so the
  // controller can stream it through without buffering.
  async chat(orgId: string, messages: HermesMessageDto[]) {
    const organization = await this._hermesRepository.getOrganization(orgId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    if (!organization.hermesUrl) {
      throw new BadRequestException('No Hermes agent is connected yet');
    }

    const url = this.completionsUrl(organization.hermesUrl);
    const apiKey = organization.hermesApiKey
      ? AuthService.fixedDecryption(organization.hermesApiKey)
      : undefined;

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      // No model is sent: the Hermes gateway decides which one serves the key.
      body: JSON.stringify({
        messages: messages.map((message) => this.toWireMessage(message)),
        stream: true,
      }),
      // The URL is supplied by the user, so the request must not be able to
      // reach the private network this backend sits in.
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
    });
  }

  // People paste the base URL of an OpenAI-compatible API far more often than
  // the completions path itself, so accept either.
  async getConversations(orgId: string) {
    return this._hermesRepository.getConversations(orgId);
  }

  async getConversation(orgId: string, id: string) {
    const conversation = await this._hermesRepository.getConversation(orgId, id);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messages: this.parseMessages(conversation.messages),
    };
  }

  // The whole thread is written at once, so a conversation is created on its
  // first exchange and replaced on every one after that.
  async saveConversation(
    orgId: string,
    messages: { role: string; content: string }[],
    id?: string
  ) {
    // The first thing the user said names the thread.
    const first = messages.find((message) => message.role === 'user');
    const title = (first?.content || '').slice(0, 80);
    const serialized = JSON.stringify(messages);

    if (id) {
      const { count } = await this._hermesRepository.updateConversation(
        orgId,
        id,
        { messages: serialized, ...(title ? { title } : {}) }
      );

      if (count) {
        return { id };
      }
    }

    const created = await this._hermesRepository.createConversation(
      orgId,
      title,
      serialized
    );

    return { id: created.id };
  }

  async deleteConversation(orgId: string, id: string) {
    await this._hermesRepository.deleteConversation(orgId, id);
    return { deleted: true };
  }

  private parseMessages(raw: string) {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  private completionsUrl(value: string) {
    const parsed = new URL(this.assertHttpUrl(value));

    if (parsed.pathname.replace(/\/+$/, '').endsWith(COMPLETIONS_PATH)) {
      return parsed.href;
    }

    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}${COMPLETIONS_PATH}`;
    return parsed.href;
  }

  // A message with attachments goes out in the multimodal content-part shape;
  // without them it stays a plain string, so nothing changes for the ordinary
  // case.
  private toWireMessage(message: HermesMessageDto) {
    const attachments = message.attachments || [];
    const images = attachments.filter(
      (attachment) => attachment.mime.startsWith('image/') && attachment.data
    );
    // Files that were uploaded instead of inlined are handed over as links, so
    // the agent can fetch them itself.
    const linked = attachments.filter((attachment) => attachment.url);

    if (!images.length && !linked.length) {
      return { role: message.role, content: message.content };
    }

    const described = linked
      .map(
        (attachment) =>
          `Attached ${attachment.mime || 'file'}: ${attachment.name} — ${
            attachment.url
          }`
      )
      .join('\n');

    const text = [message.content, described].filter(Boolean).join('\n\n');

    if (!images.length) {
      return { role: message.role, content: text };
    }

    return {
      role: message.role,
      content: [
        ...(text ? [{ type: 'text', text }] : []),
        ...images.map((image) => ({
          type: 'image_url',
          image_url: { url: image.data },
        })),
      ],
    };
  }

  private assertHttpUrl(value: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch (err) {
      throw new BadRequestException('The Hermes URL is not a valid URL');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException('The Hermes URL must be http or https');
    }

    return parsed.href;
  }
}
