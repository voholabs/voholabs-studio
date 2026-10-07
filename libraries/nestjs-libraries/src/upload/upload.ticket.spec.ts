import {
  claimUploadTicket,
  releaseUploadTicket,
  UPLOAD_TICKET_TTL_SECONDS,
} from '@gitroom/nestjs-libraries/upload/upload.ticket';
import {
  BRIEF_UPLOAD_OPTIONS,
  MEDIA_UPLOAD_OPTIONS,
} from '@gitroom/nestjs-libraries/upload/upload.limits';

// A tiny Redis with just enough of MULTI to tell whether a ticket can be
// taken twice.
const fakeRedis = () => {
  const data = new Map<string, { value: string; ttl: number }>();
  const redis: any = {
    data,
    get: jest.fn(async (key: string) => data.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, _px: string, ttl: number, nx?: string) => {
      if (nx === 'NX' && data.has(key)) {
        return null;
      }
      data.set(key, { value, ttl });
      return 'OK';
    }),
    multi: () => {
      const ops: Array<() => [null, any]> = [];
      const chain: any = {
        pttl: (key: string) => {
          ops.push(() => [null, data.has(key) ? data.get(key)!.ttl : -2]);
          return chain;
        },
        getdel: (key: string) => {
          ops.push(() => {
            const value = data.get(key)?.value ?? null;
            data.delete(key);
            return [null, value];
          });
          return chain;
        },
        exec: async () => ops.map((op) => op()),
      };
      return chain;
    },
  };
  return redis;
};

describe('upload tickets', () => {
  it('can be claimed only once', async () => {
    const redis = fakeRedis();
    redis.data.set('k', { value: 'org-1', ttl: 5000 });

    const [first, second] = await Promise.all([
      claimUploadTicket(redis, 'k'),
      claimUploadTicket(redis, 'k'),
    ]);
    expect([first, second].filter(Boolean)).toEqual([
      { organizationId: 'org-1', ttl: 5000 },
    ]);
    expect(redis.data.has('k')).toBe(false);
  });

  it('is handed back with what was left of its life after a failure', async () => {
    const redis = fakeRedis();
    redis.data.set('k', { value: 'org-1', ttl: 4000 });
    const ticket = await claimUploadTicket(redis, 'k');
    await releaseUploadTicket(redis, 'k', ticket!);
    expect(redis.set).toHaveBeenCalledWith('k', 'org-1', 'PX', 4000, 'NX');
    expect(await claimUploadTicket(redis, 'k')).toEqual({
      organizationId: 'org-1',
      ttl: 4000,
    });
  });

  it('finds nothing for an unknown ticket', async () => {
    expect(await claimUploadTicket(fakeRedis(), 'missing')).toBeNull();
  });

  it('works on the in-memory stand-in without MULTI', async () => {
    const values = new Map([['k', 'org-1']]);
    const redis = {
      get: async (key: string) => values.get(key),
      del: async (key: string) => values.delete(key),
    };
    expect(await claimUploadTicket(redis, 'k')).toEqual({
      organizationId: 'org-1',
      ttl: UPLOAD_TICKET_TTL_SECONDS * 1000,
    });
    expect(await claimUploadTicket(redis, 'k')).toBeNull();
  });
});

describe('upload limits', () => {
  it('takes one file and bounded fields', () => {
    for (const { limits } of [MEDIA_UPLOAD_OPTIONS, BRIEF_UPLOAD_OPTIONS]) {
      expect(limits.files).toBe(1);
      expect(limits.fields).toBeGreaterThan(0);
      expect(limits.parts).toBe(limits.fields + limits.files);
    }
    expect(MEDIA_UPLOAD_OPTIONS.limits.fileSize).toBe(1024 * 1024 * 1024);
    expect(BRIEF_UPLOAD_OPTIONS.limits.fileSize).toBe(25 * 1024 * 1024);
  });
});
