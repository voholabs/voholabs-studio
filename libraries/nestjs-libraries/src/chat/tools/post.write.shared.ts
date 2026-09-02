import { z } from 'zod';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { storeUrlAsMedia } from '@gitroom/nestjs-libraries/chat/tools/media.upload.helper';

const validUrlExtension = new ValidUrlExtension();
const validUrlPath = new ValidUrlPath();

/**
 * `linkToPostIds` is the discoverable form of a `(post:<id>)` reference - an
 * agent reading the input schema finds a field, where prose in a description
 * is easy to skim past. Any id listed there that the content does not already
 * reference is appended to it, so both forms end up as the same stored text.
 */
export const withPostLinks = (p: {
  content: string;
  linkToPostIds?: string[];
}) => {
  const missing = (p.linkToPostIds || []).filter(
    (id) => p.content.indexOf(`(post:${id})`) === -1
  );

  if (!missing.length) {
    return p.content;
  }

  return `${p.content}${missing.map((id) => `<p>(post:${id})</p>`).join('')}`;
};

// Same URL validation as MediaDto (valid.url.path) - each attachment must
// point to an allowed upload domain and a supported file extension.
export const attachmentUrl = z
  .string()
  .refine((url) => validUrlPath.validate(url, {} as any), {
    message: validUrlPath.defaultMessage({} as any),
  })
  .refine((url) => validUrlExtension.validate(url, {} as any), {
    message: validUrlExtension.defaultMessage({} as any),
  });

/**
 * The media entries stored on a post row. Kept as the raw stored shape so an
 * edit can hand back exactly what it read - a video's `thumbnail` and
 * `thumbnailTimestamp` are part of that, and rebuilding the entry from the
 * path alone would drop them.
 */
export const readPostMedia = (post: { image?: string | null }): any[] => {
  try {
    return JSON.parse(post?.image || '[]') || [];
  } catch (err) {
    return [];
  }
};

export const mediaOutput = z.object({
  id: z.string().nullable(),
  path: z.string(),
  thumbnail: z.string().nullable(),
});

// What the agent gets back for one attachment. `path` is the same currency the
// rest of the surface uses: it is what mediaList returns and what an
// attachments field takes, so a video read here can be handed straight back.
export const describeMedia = (post: any) =>
  readPostMedia(post).map((m: any) => ({
    id: m?.id ?? null,
    path: m?.path || '',
    thumbnail: m?.thumbnail ?? null,
  }));

// Created lazily so importing this module never touches storage config —
// read-only tools import from here too, and UploadFactory throws on an
// unknown STORAGE_PROVIDER.
let sharedStorage: ReturnType<typeof UploadFactory.createStorage> | null =
  null;
const getStorage = () => {
  if (!sharedStorage) {
    sharedStorage = UploadFactory.createStorage();
  }
  return sharedStorage;
};

/**
 * The URL prefixes of our own storage, derived from the same configuration
 * UploadFactory reads — never a hardcoded domain. Cloudflare storage returns
 * paths under CLOUDFLARE_BUCKET_URL; local storage returns paths under
 * FRONTEND_URL + '/uploads'. The local base is recognized regardless of the
 * active provider so a library that predates a storage switch is still
 * treated as ours (re-fetching those paths would duplicate — or, through the
 * SSRF-safe dispatcher, fail on — files we already host).
 */
const ownStorageBases = (): string[] => {
  const bases: string[] = [];
  const provider = process.env.STORAGE_PROVIDER || 'local';

  if (provider === 'cloudflare' && process.env.CLOUDFLARE_BUCKET_URL) {
    bases.push(process.env.CLOUDFLARE_BUCKET_URL.replace(/\/+$/, '') + '/');
  }

  if (process.env.FRONTEND_URL) {
    bases.push(process.env.FRONTEND_URL.replace(/\/+$/, '') + '/uploads/');
  }

  return bases;
};

/**
 * True only for an absolute http(s) URL that is NOT on our own storage.
 * Relative and media-library paths are not external — they are left alone.
 */
export const isExternalAttachmentUrl = (path: string): boolean => {
  if (!/^https?:\/\//i.test(path || '')) {
    return false;
  }

  return !ownStorageBases().some((base) => path.startsWith(base));
};

/**
 * Copy-on-attach: make every external attachment durable BEFORE a post is
 * written. Any path that is not already on our own storage is fetched
 * (SSRF-safe) and re-hosted in the media library, and the returned map says
 * what to store instead ({ external URL -> hosted path }). Paths already ours
 * are not in the map — callers use `map.get(path) ?? path`.
 *
 * This exists because externally generated URLs (an AI editor's CDN result,
 * a pasted link) tend to expire: attaching one looks correct today and
 * publishes a dead image weeks later. Every post-writing tool must run its
 * attachment paths through here; enforcement lives on the write path, not in
 * tool descriptions, so no tool can skip it.
 *
 * - Already-hosted and relative paths pass through untouched (no refetch, no
 *   duplicate), which also makes re-saving an already-hosted post a no-op.
 * - Duplicate URLs within one call are fetched once.
 * - A URL that cannot be fetched or is a disallowed type THROWS, with a
 *   message naming the URL — the caller must let that fail the whole write
 *   before anything is saved, because a post silently keeping the un-hosted
 *   link (or losing the attachment) is worse than a refused write.
 */
export const hostExternalAttachments = async (params: {
  mediaService: MediaService;
  organizationId: string;
  paths: string[];
}): Promise<Map<string, string>> => {
  const { mediaService, organizationId, paths } = params;

  const external = [...new Set((paths || []).filter(isExternalAttachmentUrl))];
  const hosted = new Map<string, string>();

  for (const url of external) {
    const stored = await storeUrlAsMedia({
      storage: getStorage(),
      mediaService,
      organizationId,
      url,
    });

    if (stored.error || !stored.path) {
      throw new Error(
        `The attachment "${url}" is an external URL and could not be copied into the media library (${
          stored.error || 'no hosted path was returned'
        }). Nothing was changed and no post was saved. External links expire, so a post is never saved pointing at one — fix or re-host that URL (uploadFromUrlTool can test it on its own) and try again.`
      );
    }

    hosted.set(url, stored.path);
  }

  return hosted;
};
