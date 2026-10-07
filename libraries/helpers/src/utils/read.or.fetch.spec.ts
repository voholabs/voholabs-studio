import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetchBuffer: jest.fn(async () => Buffer.from('remote')),
}));

import { safeFetchBuffer } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { readOrFetch, resolveUploadPath } from './read.or.fetch';

describe('readOrFetch', () => {
  const originalUploadDir = process.env.UPLOAD_DIRECTORY;
  let base: string;
  let uploads: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'read-or-fetch-'));
    uploads = join(base, 'uploads');
    mkdirSync(join(uploads, '2026', '10'), { recursive: true });
    writeFileSync(join(uploads, '2026', '10', 'a.png'), 'local');
    mkdirSync(join(base, 'uploads-other'));
    writeFileSync(join(base, 'uploads-other', 'b.png'), 'other');
    writeFileSync(join(base, 'secret.txt'), 'secret');
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    if (originalUploadDir === undefined) {
      delete process.env.UPLOAD_DIRECTORY;
    } else {
      process.env.UPLOAD_DIRECTORY = originalUploadDir;
    }
  });

  beforeEach(() => {
    process.env.UPLOAD_DIRECTORY = uploads;
    (safeFetchBuffer as jest.Mock).mockClear();
  });

  it('downloads http(s) paths through safeFetchBuffer', async () => {
    const out = await readOrFetch('https://cdn.example.com/a.png');
    expect(out.toString()).toBe('remote');
    expect(safeFetchBuffer).toHaveBeenCalledWith(
      'https://cdn.example.com/a.png'
    );
  });

  it('reads a file inside UPLOAD_DIRECTORY', async () => {
    const out = await readOrFetch(join(uploads, '2026', '10', 'a.png'));
    expect(out.toString()).toBe('local');
    expect(safeFetchBuffer).not.toHaveBeenCalled();
  });

  it('accepts a trailing slash on UPLOAD_DIRECTORY', async () => {
    process.env.UPLOAD_DIRECTORY = uploads + '/';
    const out = await readOrFetch(join(uploads, '2026', '10', 'a.png'));
    expect(out.toString()).toBe('local');
  });

  it('refuses a path that climbs out of UPLOAD_DIRECTORY', async () => {
    await expect(
      readOrFetch(join(uploads, '..', 'secret.txt'))
    ).rejects.toThrow('Invalid media path');
    await expect(
      readOrFetch(uploads + '/2026/../../secret.txt')
    ).rejects.toThrow('Invalid media path');
  });

  it('refuses a sibling directory that shares the prefix', async () => {
    await expect(
      readOrFetch(join(base, 'uploads-other', 'b.png'))
    ).rejects.toThrow('Invalid media path');
  });

  it('refuses absolute paths elsewhere and relative paths', async () => {
    await expect(readOrFetch('/etc/passwd')).rejects.toThrow(
      'Invalid media path'
    );
    await expect(readOrFetch('secret.txt')).rejects.toThrow(
      'Invalid media path'
    );
  });

  it('refuses the upload directory itself', () => {
    expect(() => resolveUploadPath(uploads)).toThrow('Invalid media path');
  });

  it('refuses every local path when UPLOAD_DIRECTORY is unset', async () => {
    delete process.env.UPLOAD_DIRECTORY;
    await expect(
      readOrFetch(join(uploads, '2026', '10', 'a.png'))
    ).rejects.toThrow('Invalid media path');
    process.env.UPLOAD_DIRECTORY = '';
    await expect(
      readOrFetch(join(uploads, '2026', '10', 'a.png'))
    ).rejects.toThrow('Invalid media path');
  });
});
