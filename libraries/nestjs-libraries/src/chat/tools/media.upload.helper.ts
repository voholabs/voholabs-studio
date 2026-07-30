import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { getMaxSize } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { Readable } from 'stream';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

// Same allow-list as the public API upload routes.
export const ALLOWED_MEDIA_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);

export type StoredMedia = { id?: string; path?: string; error?: string };

type Storage = ReturnType<typeof UploadFactory.createStorage>;

/**
 * Sniff, validate and store a buffer in the media library. The declared file
 * name is never trusted for the type — it is taken from the bytes themselves,
 * the same way CustomFileValidationPipe does it for HTTP uploads.
 */
export const storeBufferAsMedia = async (params: {
  storage: Storage;
  mediaService: MediaService;
  organizationId: string;
  buffer: Buffer;
  fileName?: string;
}): Promise<StoredMedia> => {
  const { storage, mediaService, organizationId, buffer, fileName } = params;

  const detected = await fromBuffer(buffer);
  if (!detected || !ALLOWED_MEDIA_MIME.has(detected.mime)) {
    return {
      error:
        'Unsupported file type. Allowed: jpeg, png, gif, webp, avif, bmp, tiff and mp4.',
    };
  }

  const maxSize = getMaxSize(detected.mime);
  if (buffer.length > maxSize) {
    return {
      error: `File is too large: ${buffer.length} bytes (max ${maxSize} bytes).`,
    };
  }

  const safeBase =
    (fileName || 'upload')
      .replace(/\.[^./\\]*$/, '')
      .replace(/[\\/]/g, '_')
      .slice(0, 100) || 'upload';

  const getFile = await storage.uploadFile({
    buffer,
    mimetype: detected.mime,
    size: buffer.length,
    path: '',
    fieldname: '',
    destination: '',
    stream: new Readable(),
    filename: '',
    originalname: `${safeBase}.${detected.ext}`,
    encoding: '',
  });

  const saved = await mediaService.saveFile(
    organizationId,
    getFile.originalname,
    getFile.path
  );

  return { id: saved.id, path: saved.path };
};
