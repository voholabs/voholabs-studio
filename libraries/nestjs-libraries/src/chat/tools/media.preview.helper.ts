/**
 * Media references for the agent.
 *
 * An earlier version of this fetched each asset, base64'd it and returned it
 * inline as MCP image content. That does not survive contact with real posts:
 * a post image is routinely a 3 MB PNG, so a five-slide thread came back as a
 * 15 MB tool response and the client showed the user nothing. Downscaling made
 * the numbers work but was the wrong shape - it silently degraded the asset,
 * and it has no answer at all for video, where no quality setting makes
 * inlining viable.
 *
 * So nothing is inlined. The agent is handed a reference it can load itself,
 * at whatever fidelity it actually needs, and the same shape works for a 40 MB
 * video as for a thumbnail.
 */

/** No payload is returned, so this only bounds the size of the reference list. */
export const MAX_REFERENCE_ITEMS = 50;

/**
 * Best-effort MIME from the file extension.
 *
 * Media rows carry a coarse `type` ("image"/"video") and no MIME column, and
 * nothing here downloads a file just to sniff it - the caller loads the asset
 * itself and gets the authoritative Content-Type from that request. This is a
 * hint for deciding what is worth loading.
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
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    default:
      return null;
  }
};

/**
 * Coarse kind, from the stored Media.type when there is a row for it and from
 * the extension otherwise. Lets the agent tell "this is a video, do not try to
 * look at it as a picture" without loading anything.
 */
export const mediaKind = (
  storedType: string | null | undefined,
  mimeType: string | null
): 'image' | 'video' | 'unknown' => {
  if (storedType === 'image' || storedType === 'video') {
    return storedType;
  }

  if (mimeType && mimeType.indexOf('image/') === 0) {
    return 'image';
  }

  if (mimeType && mimeType.indexOf('video/') === 0) {
    return 'video';
  }

  return 'unknown';
};

/**
 * A human-readable name for a reference. MCP requires `name` on a
 * resource_link, and the library's originalName is often null, so fall back to
 * the file name in the path.
 */
export const referenceName = (
  originalName: string | null | undefined,
  path: string
): string => {
  if (originalName) {
    return originalName;
  }

  const last = (path || '').split('?')[0].split('/').pop();
  return last || 'media';
};
