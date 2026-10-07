import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// An in-memory stand-in for the parts of ioredis the guard uses.
const store = new Map<string, number>();
const ttls = new Map<string, number>();
let redisDown = false;

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    multi: () => {
      const ops: Array<() => [Error | null, unknown]> = [];
      const chain = {
        set: (key: string, value: string, _ex: string, ttl: number) => {
          ops.push(() => {
            if (store.has(key)) return [null, null];
            store.set(key, Number(value));
            ttls.set(key, ttl);
            return [null, 'OK'];
          });
          return chain;
        },
        incr: (key: string) => {
          ops.push(() => {
            const next = (store.get(key) || 0) + 1;
            store.set(key, next);
            return [null, next];
          });
          return chain;
        },
        exec: async () => {
          if (redisDown) throw new Error('connection refused');
          return ops.map((op) => op());
        },
      };
      return chain;
    },
  },
}));

import {
  AuthLimits,
  AuthRateLimitGuard,
  AuthRateLimitRule,
  clientIp,
} from '@gitroom/nestjs-libraries/throttler/auth.rate.limit.guard';

class FakeController {
  login() {}
}

const contextFor = (
  rules: AuthRateLimitRule[],
  req: { headers?: Record<string, string>; body?: any; ip?: string }
) => {
  const handler = FakeController.prototype.login;
  const reflector = {
    get: () => rules,
  } as unknown as Reflector;
  const context: any = {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, ip: '10.0.0.1', ...req }),
    }),
  };
  return { guard: new AuthRateLimitGuard(reflector), context };
};

const attempt = async (
  rules: AuthRateLimitRule[],
  req: Parameters<typeof contextFor>[1]
) => {
  const { guard, context } = contextFor(rules, req);
  try {
    return await guard.canActivate(context);
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
};

describe('AuthRateLimitGuard', () => {
  beforeEach(() => {
    store.clear();
    ttls.clear();
    redisDown = false;
  });

  it('lets the first 10 login attempts for an email through and refuses the 11th', async () => {
    const req = {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
      body: { email: 'Someone@Example.com', password: 'x' },
    };
    for (let i = 0; i < 10; i++) {
      expect(await attempt(AuthLimits.login, req)).toBe(true);
    }
    expect(await attempt(AuthLimits.login, req)).toBe(429);
  });

  it('counts emails case-insensitively and per IP', async () => {
    for (let i = 0; i < 10; i++) {
      await attempt(AuthLimits.login, {
        headers: { 'cf-connecting-ip': '1.2.3.4' },
        body: { email: i % 2 ? 'A@B.CO' : 'a@b.co' },
      });
    }
    expect(
      await attempt(AuthLimits.login, {
        headers: { 'cf-connecting-ip': '1.2.3.4' },
        body: { email: 'a@b.co' },
      })
    ).toBe(429);
    // Another address from the same IP is still fine.
    expect(
      await attempt(AuthLimits.login, {
        headers: { 'cf-connecting-ip': '1.2.3.4' },
        body: { email: 'other@b.co' },
      })
    ).toBe(true);
    // The same address from another IP is too.
    expect(
      await attempt(AuthLimits.login, {
        headers: { 'cf-connecting-ip': '5.6.7.8' },
        body: { email: 'a@b.co' },
      })
    ).toBe(true);
  });

  it('caps one IP across many emails', async () => {
    for (let i = 0; i < 100; i++) {
      expect(
        await attempt(AuthLimits.login, {
          headers: { 'cf-connecting-ip': '9.9.9.9' },
          body: { email: `user${i}@b.co` },
        })
      ).toBe(true);
    }
    expect(
      await attempt(AuthLimits.login, {
        headers: { 'cf-connecting-ip': '9.9.9.9' },
        body: { email: 'fresh@b.co' },
      })
    ).toBe(429);
  });

  it('creates every counter with its window as expiry', async () => {
    await attempt(AuthLimits.forgot, {
      headers: { 'cf-connecting-ip': '1.1.1.1' },
      body: { email: 'a@b.co' },
    });
    expect([...ttls.values()].sort()).toEqual([3600, 3600]);
    expect(ttls.size).toBe(store.size);
  });

  it('lets requests through when Redis is down', async () => {
    redisDown = true;
    for (let i = 0; i < 20; i++) {
      expect(
        await attempt(AuthLimits.forgot, { body: { email: 'a@b.co' } })
      ).toBe(true);
    }
  });

  it('does nothing on a route without rules', async () => {
    expect(await attempt([], {})).toBe(true);
    expect(store.size).toBe(0);
  });
});

describe('clientIp', () => {
  it('prefers cf-connecting-ip, then the first x-forwarded-for hop, then req.ip', () => {
    expect(
      clientIp({
        headers: {
          'cf-connecting-ip': '1.1.1.1',
          'x-forwarded-for': '2.2.2.2, 3.3.3.3',
        },
        ip: '4.4.4.4',
      } as any)
    ).toBe('1.1.1.1');
    expect(
      clientIp({
        headers: { 'x-forwarded-for': '2.2.2.2, 3.3.3.3' },
        ip: '4.4.4.4',
      } as any)
    ).toBe('2.2.2.2');
    expect(clientIp({ headers: {}, ip: '4.4.4.4' } as any)).toBe('4.4.4.4');
  });
});
