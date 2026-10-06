import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';

// The steps of a multipart upload the widget may call. It never sends the
// file here: each part goes from the user's browser straight to the bucket on
// a presigned URL, so file size is not limited by this server or its proxy.
const WIDGET_STEPS = [
  'create-multipart-upload',
  'sign-part',
  'complete-multipart-upload',
  'abort-multipart-upload',
];

@ApiTags('Media')
@Controller('/media-widget')
export class MediaWidgetController {
  constructor(private _mediaService: MediaService) {}

  @Post('/r2/:endpoint')
  async r2(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    if (!WIDGET_STEPS.includes(endpoint)) {
      return res.status(404).json({ message: 'Unknown upload step' });
    }

    // Sent form-encoded as one JSON field, so the browser makes a simple
    // request and never asks for a preflight (see UploadWidgetAuthMiddleware).
    try {
      req.body = JSON.parse(req.body?.payload || '{}');
    } catch {
      return res.status(400).json({ message: 'Invalid request' });
    }

    // The announced size only turns an oversized file away early; the real
    // size is checked, and paid for, once the file is whole.
    if (endpoint === 'create-multipart-upload') {
      try {
        await this._mediaService.assertStorage(
          org.id,
          Number(req.body?.file?.size) || 0,
          { charge: false }
        );
      } catch (err: any) {
        return res
          .status(err?.getStatus?.() || 400)
          .json({ message: err?.message || 'Not enough storage' });
      }
    }

    const upload = await handleR2Upload(endpoint, req, res);
    if (endpoint !== 'complete-multipart-upload' || res.headersSent) {
      return upload;
    }

    try {
      const media = await this._mediaService.saveUploadSessionFile(
        org.id,
        // @ts-ignore
        req.uploadSession,
        // @ts-ignore
        upload.Location,
        req.body?.file?.name
      );
      return res.status(200).json({
        id: media.id,
        path: media.path,
        name: media.originalName || media.name,
      });
    } catch (err: any) {
      return res
        .status(err?.getStatus?.() || 400)
        .json({ message: err?.message || 'Upload failed' });
    }
  }

  @Get('/status')
  status(@GetOrgFromRequest() org: Organization, @Req() req: Request) {
    // @ts-ignore
    return this._mediaService.getUploadSession(org.id, req.uploadSession);
  }
}
