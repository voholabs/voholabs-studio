import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { HermesService } from '@gitroom/nestjs-libraries/database/prisma/hermes/hermes.service';
import {
  HermesChatDto,
  HermesSaveConversationDto,
  HermesSettingsDto,
} from '@gitroom/nestjs-libraries/dtos/hermes/hermes.dto';

@ApiTags('Hermes')
@Controller('/hermes')
@CheckPolicies([AuthorizationActions.Create, Sections.AI])
export class HermesController {
  constructor(private _hermesService: HermesService) {}

  @Get('/')
  getSettings(@GetOrgFromRequest() org: Organization) {
    return this._hermesService.getSettings(org.id);
  }

  @Put('/')
  setSettings(
    @GetOrgFromRequest() org: Organization,
    @Body() body: HermesSettingsDto
  ) {
    return this._hermesService.setSettings(org.id, body);
  }

  @Get('/conversations')
  getConversations(@GetOrgFromRequest() org: Organization) {
    return this._hermesService.getConversations(org.id);
  }

  @Get('/conversations/:id')
  getConversation(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._hermesService.getConversation(org.id, id);
  }

  @Post('/conversations')
  saveConversation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: HermesSaveConversationDto
  ) {
    return this._hermesService.saveConversation(org.id, body.messages, body.id);
  }

  @Delete('/conversations/:id')
  deleteConversation(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._hermesService.deleteConversation(org.id, id);
  }

  // Proxied rather than called from the browser, so the key stays on the server
  // and the endpoint is never exposed to the client.
  @Post('/chat')
  async chat(
    @GetOrgFromRequest() org: Organization,
    @Body() body: HermesChatDto,
    @Res() res: Response
  ) {
    const upstream = await this._hermesService.chat(org.id, body.messages);

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      res.status(502).json({
        error: `The Hermes agent returned ${upstream.status}`,
        detail: detail.slice(0, 500),
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Belt and braces with the nginx config: this is the explicit per-response
    // signal to any proxy in front not to hold the stream back.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();

    // Stop pulling from Hermes as soon as the browser goes away, instead of
    // draining a stream nobody is reading.
    let closed = false;
    res.on('close', () => {
      closed = true;
      reader.cancel().catch(() => undefined);
    });

    try {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        res.write(Buffer.from(value));
      }
    } catch (err) {
      // The stream broke midway; the client already has whatever arrived.
    } finally {
      res.end();
    }
  }
}
