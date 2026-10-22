import { randomBytes } from 'crypto';
import {
  AuthService,
  decryptLegacySecret,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  lookupCandidates,
  lookupHash,
} from '@gitroom/helpers/auth/auth.service';
import { StoredSecretsService } from './stored-secrets/stored-secrets.service';
import { channelSecretsMiddleware, PrismaService } from './prisma.service';

describe('channel token encryption', () => {
  const previous = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  const previousJwt = process.env.JWT_SECRET;
  afterAll(() => {
    process.env.ENCRYPTION_KEY = previous;
    process.env.JWT_SECRET = previousJwt;
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
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => decryptSecret(stored)).toThrow();
  });

  it('refuses to work without a key', () => {
    process.env.ENCRYPTION_KEY = '';
    expect(() => encryptSecret('t')).toThrow('ENCRYPTION_KEY');
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
  describe('stored credentials', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = 'jwt-secret-for-tests';
    });

    it('keeps compared-only credentials as a keyed hash', () => {
      expect(lookupHash('pos_token')).toBe(lookupHash('pos_token'));
      expect(lookupHash('pos_token')).toMatch(/^h1:/);
      expect(lookupHash('pos_token')).not.toContain('pos_token');
      expect(lookupHash('pos_token')).not.toBe(lookupHash('pos_other'));
    });

    it('still finds rows stored with the older JWT_SECRET encryption', () => {
      const legacy = AuthService.fixedEncryption('pos_token');
      expect(lookupCandidates('pos_token')).toEqual([
        lookupHash('pos_token'),
        legacy,
      ]);
    });

    it('reads back both the new and the older encryption', () => {
      expect(AuthService.fixedDecryption(encryptSecret('key'))).toBe('key');
      expect(
        AuthService.fixedDecryption(AuthService.fixedEncryption('key'))
      ).toBe('key');
    });

    it('tells the older encryption apart from other values', () => {
      expect(decryptLegacySecret(AuthService.fixedEncryption('key'))).toBe(
        'key'
      );
      expect(decryptLegacySecret('{"url":"https://x"}')).toBeNull();
      expect(decryptLegacySecret('abc')).toBeNull();
    });

    it('moves older rows, hashing or encrypting by column', async () => {
      const legacy = AuthService.fixedEncryption('secret');
      const writes: any[] = [];
      const rows = [
        { id: 'a', value: legacy },
        { id: 'b', value: 'not encrypted' },
      ];
      const write =
        (column: string) =>
        async (...args: any[]) => {
          writes.push([column, ...args]);
          return 1;
        };
      const none = async () => [];
      const service = new StoredSecretsService({
        organizationSecrets: async (field: string) =>
          field === 'hermesApiKey' ? rows : [],
        rewriteOrganizationSecret: async (field: string, ...args: any[]) =>
          write(`Organization.${field}`)(...args),
        thirdPartyKeys: none,
        integrationDetails: none,
        selfHostedSecrets: none,
        oauthAccessTokens: none,
        oauthAppSecrets: async () => rows,
        rewriteOAuthAppSecret: write('OAuthApp.clientSecret'),
      } as any);

      const dry = await service.moveToEncryptionKey(false);
      expect(writes).toHaveLength(0);
      expect(dry.columns[0]).toMatchObject({ legacy: 1, unreadable: 1 });

      const done = await service.moveToEncryptionKey(true);
      expect(
        done.columns.find((c) => c.column === 'OAuthApp.clientSecret')
      ).toMatchObject({ moved: 1, unreadable: 1 });
      const hashed = writes.find((w) => w[0] === 'OAuthApp.clientSecret');
      expect(hashed).toEqual([
        'OAuthApp.clientSecret',
        'a',
        legacy,
        lookupHash('secret'),
      ]);
      const encrypted = writes.find(
        (w) => w[0] === 'Organization.hermesApiKey'
      );
      expect(decryptSecret(encrypted[3])).toBe('secret');
    });
  });
});
