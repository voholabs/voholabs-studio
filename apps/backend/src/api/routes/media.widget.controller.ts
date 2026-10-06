import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';

// The upload box's multipart upload. The file is never sent here: each part
// goes from the user's browser straight to the bucket on a URL signed for that
// part's exact size, so file size is not limited by this server or its proxy,
// and the parts cannot add up to more than the size checked at the start.
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
    // Sent form-encoded as one JSON field, so the browser makes a simple
    // request and never asks for a preflight (see UploadWidgetAuthMiddleware).
    let body: any;
    try {
      body = JSON.parse(req.body?.payload || '{}');
    } catch {
      return res.status(400).json({ message: 'Invalid request' });
    }
    // @ts-ignore
    const sessionId: string = req.uploadSession;

    try {
      switch (endpoint) {
        case 'create-multipart-upload':
          return res
            .status(200)
            .json(
              await this._mediaService.startUploadSessionFile(
                org.id,
                sessionId,
                body?.file || {}
              )
            );

        case 'sign-part':
          return res
            .status(200)
            .json(
              await this._mediaService.signUploadSessionPart(
                org.id,
                String(body?.uploadId || ''),
                Number(body?.partNumber)
              )
            );

        case 'abort-multipart-upload':
        case 'complete-multipart-upload': {
          // The key comes from the record made at the start, never the browser.
          const upload = await this._mediaService.uploadSessionPart(
            org.id,
            String(body?.uploadId || '')
          );
          req.body = { ...body, key: upload.key, uploadId: body.uploadId };
          // A .mov from the box is stored as .mp4 (createWidgetUpload).
          // @ts-ignore
          req.allowQuickTime = true;
          const result = await handleR2Upload(endpoint, req, res);
          if (endpoint === 'abort-multipart-upload' || res.headersSent) {
            return result;
          }
          const media = await this._mediaService.saveUploadSessionFile(
            org.id,
            sessionId,
            // @ts-ignore
            result.Location,
            body?.file?.name
          );
          return res.status(200).json({
            id: media.id,
            path: media.path,
            name: media.originalName || media.name,
          });
        }
      }
      return res.status(404).json({ message: 'Unknown upload step' });
    } catch (err: any) {
      if (res.headersSent) {
        return;
      }
      return res
        .status(err?.getStatus?.() || 500)
        .json({ message: err?.message || 'Upload failed' });
    }
  }

  @Get('/status')
  status(@GetOrgFromRequest() org: Organization, @Req() req: Request) {
    // @ts-ignore
    return this._mediaService.getUploadSession(org.id, req.uploadSession);
  }
}
