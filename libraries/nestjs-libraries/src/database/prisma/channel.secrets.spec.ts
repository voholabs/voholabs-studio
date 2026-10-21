import { randomBytes } from 'crypto';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '@gitroom/helpers/auth/auth.service';
import { channelSecretsMiddleware, PrismaService } from './prisma.service';

describe('channel token encryption', () => {
  const previous = process.env.CHANNEL_TOKEN_KEY;
  beforeEach(() => {
    process.env.CHANNEL_TOKEN_KEY = randomBytes(32).toString('base64');
  });
  afterAll(() => {
    process.env.CHANNEL_TOKEN_KEY = previous;
  });

  it('round-trips and never stores the token itself', () => {
    const stored = encryptSecret('access-token-123');
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(stored).not.toContain('access-token-123');
    expect(encryptSecret('access-token-123')).not.toBe(stored);
    expect(decryptSecret(stored)).toBe('access-token-123');
  });

  it('reads rows stored before encryption as they are', () => {
    expect(decryptSecret('legacy-plain-token')).toBe('legacy-plain-token');
    expect(encryptSecret('')).toBe('');
  });

  it('does not encrypt twice', () => {
    const stored = encryptSecret('t');
    expect(encryptSecret(stored)).toBe(stored);
  });

  it('refuses a value encrypted under another key or changed', () => {
    const stored = encryptSecret('t');
    process.env.CHANNEL_TOKEN_KEY = randomBytes(32).toString('base64');
    expect(() => decryptSecret(stored)).toThrow();
  });

  it('refuses to work without a key', () => {
    process.env.CHANNEL_TOKEN_KEY = '';
    expect(() => encryptSecret('t')).toThrow('CHANNEL_TOKEN_KEY');
  });

  describe('prisma middleware', () => {
    it('is still registered on the client', () => {
      expect(typeof (PrismaService.prototype as any).$use).toBe('function');
      expect(() => new PrismaService()).not.toThrow();
    });

    it('encrypts Integration writes, upserts and set objects', async () => {
      const params: any = {
        model: 'Integration',
        action: 'upsert',
        args: {
          create: { token: 'a', refreshToken: 'b', name: 'n' },
          update: { token: { set: 'c' }, refreshToken: null },
        },
      };
      let seen: any;
      await channelSecretsMiddleware(params, async (p) => {
        seen = JSON.parse(JSON.stringify(p.args));
        return null;
      });
      expect(isEncryptedSecret(seen.create.token)).toBe(true);
      expect(isEncryptedSecret(seen.create.refreshToken)).toBe(true);
      expect(seen.create.name).toBe('n');
      expect(isEncryptedSecret(seen.update.token.set)).toBe(true);
      expect(seen.update.refreshToken).toBeNull();
    });

    it('leaves other models alone on write', async () => {
      const params: any = {
        model: 'GitHub',
        action: 'create',
        args: { data: { token: 'gh' } },
      };
      await channelSecretsMiddleware(params, async () => null);
      expect(params.args.data.token).toBe('gh');
    });

    it('decrypts tokens in results, nested ones included', async () => {
      const token = encryptSecret('secret');
      const createdAt = new Date();
      const result = await channelSecretsMiddleware(
        { model: 'Post', action: 'findMany', args: {} } as any,
        async () => [
          { id: 'p', createdAt, integration: { token, refreshToken: null } },
        ]
      );
      expect(result[0].integration.token).toBe('secret');
      expect(result[0].integration.refreshToken).toBeNull();
      expect(result[0].createdAt).toBe(createdAt);
    });
  });
});
