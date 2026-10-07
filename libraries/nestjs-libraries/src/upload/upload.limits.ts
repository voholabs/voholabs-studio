import { BRIEF_DOCUMENT_MAX_BYTES } from '@gitroom/nestjs-libraries/upload/brief.upload';

// What multer will read from one upload request before giving up, so an
// oversized or many-part body is refused while it is still arriving instead of
// after it has been buffered. The file size matches the largest file the
// validation pipe accepts (a 1 GB video, see getMaxSize); one file per request,
// and a handful of plain fields (upload-simple sends `preventSave`).
export const MEDIA_MAX_BYTES = 1024 * 1024 * 1024;

const common = {
  files: 1,
  fields: 20,
  parts: 21,
  fieldSize: 1024 * 1024,
  headerPairs: 200,
};

export const MEDIA_UPLOAD_OPTIONS = {
  limits: { ...common, fileSize: MEDIA_MAX_BYTES },
};

export const BRIEF_UPLOAD_OPTIONS = {
  limits: { ...common, fileSize: BRIEF_DOCUMENT_MAX_BYTES },
};
