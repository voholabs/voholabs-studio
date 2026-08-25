import { z } from 'zod';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';

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
