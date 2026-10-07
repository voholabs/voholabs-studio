import {
  Controller,
  HttpException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  claimUploadTicket,
  releaseUploadTicket,
  uploadTicketKey,
} from '@gitroom/nestjs-libraries/upload/upload.ticket';
import { MEDIA_UPLOAD_OPTIONS } from '@gitroom/nestjs-libraries/upload/upload.limits';
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
  @UseInterceptors(FileInterceptor('file', MEDIA_UPLOAD_OPTIONS))
  @UsePipes(new CustomFileValidationPipe())
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

    // Claimed in one step so the ticket is used once; a failed attempt hands
    // it back, so it can be retried within the TTL instead of stranding the
    // agent.
    const key = uploadTicketKey(token);
    const ticket = await claimUploadTicket(ioRedis, key);
    if (!ticket) {
      throw new HttpException(
        { msg: 'This upload link is invalid or has expired.' },
        404
      );
    }

    try {
      const { organizationId } = ticket;
      await this._mediaService.assertStorage(organizationId, file.size);
      const getFile = await this.storage.uploadFile(file);
      return await this._mediaService.saveFile(
        organizationId,
        getFile.originalname,
        getFile.path,
        undefined,
        file.size
      );
    } catch (err) {
      await releaseUploadTicket(ioRedis, key, ticket).catch(() => undefined);
      throw err;
    }
  }
}
