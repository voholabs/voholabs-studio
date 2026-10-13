import {
  Controller,
  HttpException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { streamUploadOptions } from '@gitroom/nestjs-libraries/upload/multer.stream.engine';
import { storedObjectSize } from '@gitroom/nestjs-libraries/upload/r2.uploader';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  claimUploadTicket,
  releaseUploadTicket,
  uploadTicketKey,
} from '@gitroom/nestjs-libraries/upload/upload.ticket';
import { UploadTicketGuard } from '@gitroom/backend/public-api/routes/v1/upload.ticket.guard';
import * as Sentry from '@sentry/nestjs';

/**
 * Deliberately NOT behind PublicAuthMiddleware — see upload.ticket.ts. The
 * ticket in the path is the credential, so this controller is kept out of the
 * authenticated list in PublicApiModule. It only ever adds a file to the
 * organization the ticket was minted for, and the ticket is burned on success.
 */
@ApiTags('Public API')
@Controller('/public/v1')
export class PublicUploadTicketController {
  private storage = UploadFactory.createStorage();

  constructor(private _mediaService: MediaService) {}

  @Post('/upload-ticket/:token')
  @UseGuards(UploadTicketGuard(uploadTicketKey))
  @UseInterceptors(FileInterceptor('file', streamUploadOptions()))
  async uploadWithTicket(
    @Param('token') token: string,
    @UploadedFile('file') file: Express.Multer.File
  ) {
    Sentry.metrics.count('public_api-request', 1);

    if (!file) {
      throw new HttpException(
        { msg: 'No file provided. Send it as multipart form data field "file".' },
        400
      );
    }

    // The file is streamed into storage (type sniffed, size capped) before
    // this runs, so anything that rejects the request removes it again.
    // Claimed in one step so the ticket is used once; a failed attempt hands
    // it back, so it can be retried within the TTL instead of stranding the
    // agent.
    const key = uploadTicketKey(token);
    const ticket = await claimUploadTicket(ioRedis, key);
    if (!ticket) {
      await this.storage.removeFile(file.path).catch(() => undefined);
      throw new HttpException(
        { msg: 'This upload link is invalid or has expired.' },
        404
      );
    }

    try {
      const { organizationId } = ticket;
      const size = (await storedObjectSize(file.filename)) || file.size || 0;
      await this._mediaService.assertStorage(organizationId, size);
      return await this._mediaService.saveFile(
        organizationId,
        file.filename,
        file.path,
        file.originalname,
        size
      );
    } catch (err) {
      await this.storage.removeFile(file.path).catch(() => undefined);
      await releaseUploadTicket(ioRedis, key, ticket).catch(() => undefined);
      throw err;
    }
  }
}
