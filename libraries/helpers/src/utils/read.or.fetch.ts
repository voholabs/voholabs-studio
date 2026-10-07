import { readFileSync } from 'fs';
import { resolve as resolvePath, sep } from 'path';
import { safeFetchBuffer } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

// Non-URL media paths are files the posts service placed under
// UPLOAD_DIRECTORY. Refuse anything that resolves outside it.
export const resolveUploadPath = (path: string): string => {
  const root = process.env.UPLOAD_DIRECTORY;
  const resolved = resolvePath(path);
  if (!root || !resolved.startsWith(resolvePath(root) + sep)) {
    throw new Error('Invalid media path');
  }
  return resolved;
};

export const readOrFetch = async (path: string): Promise<Buffer> => {
  if (path.indexOf('http') === 0) {
    return safeFetchBuffer(path);
  }

  return readFileSync(resolveUploadPath(path));
};
