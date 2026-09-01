import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

/**
 * What an MCP client will actually render as an image. This is deliberately
 * narrower than ALLOWED_MEDIA_MIME in media.upload.helper: the library accepts
 * avif, bmp and tiff, but handing those to a client as ImageContent tends to
 * show a broken box rather than a picture, and mp4 is not an image at all. A
 * file outside this set is reported per item, with its real type named, rather
 * than being returned as something the client cannot draw.
 */
export const PREVIEWABLE_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * Caps on one preview call. These exist because every byte here is base64'd
 * into the response and then into the model's context: base64 is 4/3 the size
 * of the file, so the real ceiling on the wire is ~4/3 of TOTAL_BYTE_BUDGET.
 * A five-slide carousel is the case this tool is for and fits comfortably;
 * beyond the budget the remaining items come back as errors naming the limit,
 * so the caller learns what happened instead of receiving a truncated set.
 */
export const MAX_PREVIEW_ITEMS = 10;
export const TOTAL_BYTE_BUDGET = 12 * 1024 * 1024;
export const PER_ITEM_BYTE_LIMIT = 5 * 1024 * 1024;

/**
 * Flat rather than a discriminated union on purpose: the project builds with
 * `strictNullChecks: false`, under which narrowing a union by a literal tag
 * does not hold, so `if (!result.ok)` would not give the error branch back.
 * Same shape as StoredMedia in media.upload.helper, for the same reason —
 * check `error` first, and treat the rest as present only when it is absent.
 */
export type PreviewResult = {
  base64?: string;
  mimeType?: string;
  bytes?: number;
  error?: string;
};

/**
 * Fetch one media URL and return it base64'd, or an explanation of why not.
 *
 * The type is sniffed from the bytes rather than taken from the extension or
 * the Content-Type header, matching how uploads are validated elsewhere - a
 * `.png` that is really an mp4 must not be announced to the client as an image.
 *
 * `remainingBudget` is what is left of this call's total allowance; passing it
 * in keeps the running total in the caller and this function free of state.
 */
export const fetchImageAsBase64 = async (
  url: string,
  remainingBudget: number
): Promise<PreviewResult> => {
  let response: Response;

  try {
    response = await fetch(url, {
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
    });
  } catch (err) {
    return {
      error: `Could not fetch the media: ${
        err instanceof Error ? err.message : 'network error'
      }`,
    };
  }

  if (!response.ok) {
    return { error: `Could not fetch the media: HTTP ${response.status}` };
  }

  // Check the declared size before buffering so an oversized file is refused
  // rather than pulled into memory. Content-Length can be absent or wrong, so
  // the real length is checked again below.
  const declared = Number(response.headers.get('content-length'));
  const ceiling = Math.min(PER_ITEM_BYTE_LIMIT, Math.max(remainingBudget, 0));
  if (declared && declared > ceiling) {
    return {
      error: `Image is too large to preview: ${declared} bytes (limit for this call: ${ceiling} bytes).`,
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > ceiling) {
    return {
      error: `Image is too large to preview: ${buffer.length} bytes (limit for this call: ${ceiling} bytes).`,
    };
  }

  const detected = await fromBuffer(buffer);
  if (!detected) {
    return { error: 'Could not determine the file type.' };
  }

  if (!PREVIEWABLE_MIME.has(detected.mime)) {
    return {
      error: `${detected.mime} cannot be previewed as an image. Previewable types are PNG, JPEG, GIF and WebP.`,
    };
  }

  return {
    base64: buffer.toString('base64'),
    mimeType: detected.mime,
    bytes: buffer.length,
  };
};

/**
 * Best-effort MIME for a listing, from the file extension.
 *
 * Media rows carry a coarse `type` ("image"/"video") and no MIME column, and a
 * listing must not download every attachment just to sniff it. So this is a
 * hint for choosing what to preview - mediaPreview still sniffs the real bytes
 * before calling anything an image.
 */
export const guessMimeFromPath = (path: string): string | null => {
  const ext = (path || '').split('?')[0].split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'mp4':
      return 'video/mp4';
    default:
      return null;
  }
};
