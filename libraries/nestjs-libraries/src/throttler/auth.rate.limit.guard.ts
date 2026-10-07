import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Request limits for the sign-in, sign-up and recovery routes, counted in
 * Redis so every backend instance shares them.
 *
 * Fixed windows (INCR, with EXPIRE set when the key is first created). Each
 * route names one or more rules; a rule counts per client IP, or per email in
 * the body, or per the two together. The first rule over its limit answers 429.
 *
 * If Redis is unavailable the request goes through: a Redis blip must never
 * lock people out of their accounts.
 */
export type AuthRateLimitRule = {
  // Distinguishes rules on the same route in the Redis key.
  name: string;
  limit: number;
  windowSeconds: number;
  by: 'ip' | 'email' | 'ip+email';
};

export const AUTH_RATE_LIMIT = 'auth-rate-limit';
export const AuthRateLimit = (...rules: AuthRateLimitRule[]) =>
  SetMetadata(AUTH_RATE_LIMIT, rules);

const REDIS_TIMEOUT_MS = 1500;
const MINUTE = 60;
const HOUR = 60 * MINUTE;

// The limits per route, kept together so they are easy to review.
export const AuthLimits = {
  login: [
    { name: 'ip-email', limit: 10, windowSeconds: 15 * MINUTE, by: 'ip+email' },
    { name: 'ip', limit: 100, windowSeconds: 15 * MINUTE, by: 'ip' },
  ],
  forgot: [
    { name: 'email', limit: 5, windowSeconds: HOUR, by: 'email' },
    { name: 'ip', limit: 30, windowSeconds: HOUR, by: 'ip' },
  ],
  resendActivation: [
    { name: 'email', limit: 5, windowSeconds: HOUR, by: 'email' },
    { name: 'ip', limit: 30, windowSeconds: HOUR, by: 'ip' },
  ],
  register: [{ name: 'ip', limit: 20, windowSeconds: HOUR, by: 'ip' }],
  activate: [{ name: 'ip', limit: 20, windowSeconds: 15 * MINUTE, by: 'ip' }],
  forgotReturn: [
    { name: 'ip', limit: 20, windowSeconds: 15 * MINUTE, by: 'ip' },
  ],
  oauthExists: [
    { name: 'ip', limit: 60, windowSeconds: 15 * MINUTE, by: 'ip' },
  ],
  deviceCode: [{ name: 'ip', limit: 30, windowSeconds: HOUR, by: 'ip' }],
  // The CLI polls every 5 seconds for up to 15 minutes (180 requests). Many
  // terminals can share one office or VPN address, so leave room for several
  // sign-ins at once; the device code itself is 40 random characters.
  deviceToken: [
    { name: 'ip', limit: 1500, windowSeconds: 15 * MINUTE, by: 'ip' },
  ],
  deviceApprove: [
    { name: 'ip', limit: 30, windowSeconds: 15 * MINUTE, by: 'ip' },
  ],
} satisfies Record<string, AuthRateLimitRule[]>;

const firstHeader = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim() || '';

/**
 * The address of the person on the other end. Traffic arrives through
 * Cloudflare, then nginx, then Express: Cloudflare puts the visitor's address
 * in cf-connecting-ip; without it, the first hop of x-forwarded-for.
 */
export const clientIp = (req: Request) =>
  firstHeader(req.headers['cf-connecting-ip']) ||
  firstHeader(req.headers['x-forwarded-for']) ||
  req.ip ||
  req.socket?.remoteAddress ||
  'unknown';

const emailOf = (req: Request) => {
  const email = (req.body as any)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private static _logger = new Logger('AuthRateLimitGuard');
  private static _warned = false;

  constructor(private _reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this._reflector.get<AuthRateLimitRule[] | undefined>(
      AUTH_RATE_LIMIT,
      context.getHandler()
    );
    if (!rules?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const ip = clientIp(req);
    const email = emailOf(req);

    for (const rule of rules) {
      const subject =
        rule.by === 'ip' ? ip : rule.by === 'email' ? email : `${ip}|${email}`;

      // No email in the body: nothing to count by email.
      if (rule.by === 'email' && !email) {
        continue;
      }

      const count = await this.hit(
        `auth-rl:${route}:${rule.name}:${subject}`,
        rule.windowSeconds
      );

      if (count !== null && count > rule.limit) {
        throw new HttpException(
          'Too many attempts. Please wait a while and try again.',
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
    }

    return true;
  }

  // The count in this window including this request, or null if Redis could
  // not be reached (in which case the request is let through).
  private async hit(key: string, windowSeconds: number) {
    let timer: NodeJS.Timeout | undefined;
    try {
      // One transaction: the key is created with its expiry, then counted, so
      // a counter can never be left behind without one.
      const exec = ioRedis
        .multi()
        .set(key, '0', 'EX', windowSeconds, 'NX')
        .incr(key)
        .exec();
      // A Redis that is down queues commands instead of failing them; do not
      // keep somebody waiting at the sign-in form for it.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Redis did not answer in time')),
          REDIS_TIMEOUT_MS
        );
      });
      const results = await Promise.race([exec, timeout]);
      const [incrErr, count] = results?.[1] || [];
      if (incrErr || typeof count !== 'number') {
        throw incrErr || new Error('Unexpected Redis reply');
      }
      return count;
    } catch (err) {
      if (!AuthRateLimitGuard._warned) {
        AuthRateLimitGuard._warned = true;
        AuthRateLimitGuard._logger.warn(
          `Rate limiting is off while Redis is unavailable: ${
            (err as Error)?.message
          }`
        );
      }
      return null;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
