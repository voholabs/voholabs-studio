import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ApiTags } from '@nestjs/swagger';
import handleR2Upload, {
  deleteStoredObject,
  storedObjectSize,
} from '@gitroom/nestjs-libraries/upload/r2.uploader';
import { FileInterceptor } from '@nestjs/platform-express';
import { streamUploadOptions } from '@gitroom/nestjs-libraries/upload/multer.stream.engine';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';

@ApiTags('Media')
@Controller('/media')
export class MediaController {
  private storage = UploadFactory.createStorage();
  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService
  ) {}

  // The file is streamed into storage before the handler runs, so its size is
  // only known afterwards. Read it back, and drop the stored copy when it
  // would take the organization past its storage allowance.
  private async assertStoredFileFits(orgId: string, file: Express.Multer.File) {
    const size = file.size || (await storedObjectSize(file.filename));
    try {
      await this._mediaService.assertStorage(orgId, size);
    } catch (err) {
      await this.storage.removeFile(file.path).catch(() => undefined);
      throw err;
    }
    return size;
  }

  @Delete('/:id')
  deleteMedia(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._mediaService.deleteMedia(org.id, id);
  }

  @Post('/generate-video')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    console.log('hello');
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/generate-image')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false
  ) {
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      return false;
    }

    return {
      output:
        'data:image/png;base64,' +
        (await this._mediaService.generateImage(prompt, org, isPicturePrompt)),
    };
  }

  @Post('/generate-image-with-prompt')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async generateImageFromText(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string
  ) {
    const image = await this.generateImage(org, req, prompt, true);
    if (!image) {
      return false;
    }

    const file = await this.storage.uploadSimple(image.output);

    return this._mediaService.saveFile(org.id, file.split('/').pop(), file);
  }

  @Post('/upload-server')
  @UseInterceptors(FileInterceptor('file', streamUploadOptions()))
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const size = await this.assertStoredFileFits(org.id, file);
    return this._mediaService.saveFile(
      org.id,
      file.filename,
      file.path,
      file.originalname,
      size
    );
  }

  @Post('/save-media')
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('name') name: string,
    @Body('originalName') originalName: string
  ) {
    if (!name) {
      return false;
    }
    // Already in the bucket, so the size is read back rather than taken from
    // the browser.
    const size = await storedObjectSize(name);
    await this._mediaService.assertStorage(org.id, size);
    return this._mediaService.saveFile(
      org.id,
      name,
      process.env.CLOUDFLARE_BUCKET_URL + '/' + name,
      originalName || undefined,
      size
    );
  }

  @Post('/information')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._mediaService.saveMediaInformation(org.id, body);
  }

  @Post('/upload-simple')
  @UseInterceptors(FileInterceptor('file', streamUploadOptions()))
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('preventSave') preventSave: string = 'false'
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const size = await this.assertStoredFileFits(org.id, file);

    if (preventSave === 'true') {
      return { path: file.path };
    }

    return this._mediaService.saveFile(
      org.id,
      file.filename,
      file.path,
      file.originalname,
      size
    );
  }

  @Post('/:endpoint')
  async uploadFile(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    // The size the browser announces only turns an oversized upload away
    // early. What counts is the real size, checked once the file is whole.
    if (endpoint === 'create-multipart-upload') {
      await this._mediaService.assertStorage(
        org.id,
        Number(req.body?.file?.size) || 0
      );
    }

    const upload = await handleR2Upload(endpoint, req, res);
    // a rejected or failed completion has already answered with its own status
    if (endpoint !== 'complete-multipart-upload' || res.headersSent) {
      return upload;
    }

    // @ts-ignore
    const name = upload.Location.split('/').pop();
    const originalName = req.body?.file?.name;

    const size = await storedObjectSize(name);
    try {
      await this._mediaService.assertStorage(org.id, size);
    } catch (err) {
      await deleteStoredObject(name);
      throw err;
    }

    const saveFile = await this._mediaService.saveUploadedFile(
      org.id,
      name,
      // @ts-ignore
      upload.Location,
      originalName || undefined,
      size
    );

    res.status(200).json({ ...upload, saved: saveFile });
  }

  @Get('/:id/status')
  getMediaStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._mediaService.getMediaStatus(org.id, id);
  }

  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number,
    @Query('search') search?: string
  ) {
    return this._mediaService.getMedia(org.id, page, search);
  }

  @Get('/video-options')
  getVideos() {
    return this._mediaService.getVideoOptions();
  }

  @Post('/video/function')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  videoFunction(
    @Body() body: VideoFunctionDto
  ) {
    return this._mediaService.videoFunction(body.identifier, body.functionName, body.params);
  }

  @Get('/generate-video/:type/allowed')
  generateVideoAllowed(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: string
  ) {
    return this._mediaService.generateVideoAllowed(org, type);
  }
}
