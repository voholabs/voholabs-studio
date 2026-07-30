import {
  Controller,
  HttpException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { uploadTicketKey } from '@gitroom/nestjs-libraries/upload/upload.ticket';
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
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadWithTicket(
    @Param('token') token: string,
    @UploadedFile('file') file: Express.Multer.File
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const key = uploadTicketKey(token);
    const organizationId = await ioRedis.get(key);
    if (!organizationId) {
      throw new HttpException(
        { msg: 'This upload link is invalid or has expired.' },
        404
      );
    }

    if (!file) {
      throw new HttpException(
        { msg: 'No file provided. Send it as multipart form data field "file".' },
        400
      );
    }

    const getFile = await this.storage.uploadFile(file);
    const saved = await this._mediaService.saveFile(
      organizationId,
      getFile.originalname,
      getFile.path
    );

    // Burn the ticket only once the file is safely stored, so a failed attempt
    // can be retried within the TTL instead of stranding the agent.
    await ioRedis.del(key);

    return saved;
  }
}
