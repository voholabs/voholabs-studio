import { createHash } from 'crypto';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import {
  isAllowedRedirectUri,
  matchRedirectUri,
  verifyPkce,
  redirectLabel,
} from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'a'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');

const makeRepo = () => {
  const apps: any[] = [];
  const auths: any[] = [];
  return {
    apps,
    auths,
    createPublicApp: async (data: any) => {
      const app = {
        id: `app-${apps.length}`,
        ...data,
        redirectUrl: data.redirectUris[0],
        isPublic: true,
        createdAt: new Date(),
        deletedAt: null,
      };
      apps.push(app);
      return app;
    },
    getAppByClientId: async (clientId: string) =>
      apps.find((a) => a.clientId === clientId) || null,
    createAuthorization: async (data: any) => {
      auths.push({ id: `auth-${auths.length}`, ...data });
    },
    findByCode: async (code: string) =>
      auths.find((a) => a.authorizationCode === code) || null,
    exchangeCodeForToken: async () => ({
      organizationId: 'org-1',
      organization: { paymentId: 'cus_1' },
    }),
  };
};

describe('redirect URIs a client may register', () => {
  it('accepts https and loopback http, nothing else', () => {
    expect(isAllowedRedirectUri(CLAUDE)).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3118/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://evil.com/callback')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-retrieval/oauth/user-x/callback')).toBe(true);
    expect(isAllowedRedirectUri('data:text/html,hi')).toBe(false);
    expect(isAllowedRedirectUri('file:///etc/passwd')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
  });

  it('matches loopback on any port but https exactly', () => {
    const loop = ['http://localhost/callback'];
    expect(matchRedirectUri(loop, 'http://localhost:51234/callback')).toBe(
      'http://localhost:51234/callback'
    );
    expect(matchRedirectUri(loop, 'http://localhost:5/other')).toBeNull();
    expect(matchRedirectUri([CLAUDE], CLAUDE)).toBe(CLAUDE);
    expect(matchRedirectUri([CLAUDE], CLAUDE + '?x=1')).toBeNull();
    expect(
      matchRedirectUri([CLAUDE], 'https://claude.ai.evil.com/api/mcp/auth_callback')
    ).toBeNull();
  });

  it('names where the user is sent back to', () => {
    expect(redirectLabel(CLAUDE)).toBe('claude.ai');
    expect(redirectLabel('http://localhost:3118/callback')).toBe('localhost:3118');
    expect(redirectLabel('cursor://anysphere.cursor-retrieval/oauth/cb')).toBe(
      'cursor://anysphere.cursor-retrieval'
    );
  });

  it('verifies S256 PKCE', () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce('b'.repeat(50), challenge)).toBe(false);
  });
});

describe('OAuthService for a self-registered AI assistant', () => {
  const setup = async () => {
    const repo = makeRepo();
    const service = new OAuthService(repo as any);
    const reg = await service.registerClient({
      redirect_uris: [CLAUDE],
      client_name: 'Claude',
    });
    return { repo, service, reg };
  };

  it('registers a public client', async () => {
    const { reg } = await setup();
    expect(reg.client_id).toMatch(/^pca_/);
    expect(reg.token_endpoint_auth_method).toBe('none');
    expect(reg.redirect_uris).toEqual([CLAUDE]);
    expect(reg).not.toHaveProperty('client_secret');
  });

  it('refuses a non-https redirect at registration', async () => {
    const { service } = await setup();
    await expect(
      service.registerClient({ redirect_uris: ['http://evil.com/cb'] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires PKCE and a registered redirect on the consent screen', async () => {
    const { service, reg } = await setup();
    await expect(
      service.checkAuthorizationRequest(reg.client_id, { redirectUri: CLAUDE })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.checkAuthorizationRequest(reg.client_id, {
        redirectUri: 'https://evil.com/cb',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      })
    ).rejects.toMatchObject({ status: 400 });
    const ok = await service.checkAuthorizationRequest(reg.client_id, {
      redirectUri: CLAUDE,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });
    expect(ok.redirectUri).toBe(CLAUDE);
  });

  const issue = async () => {
    const ctx = await setup();
    const app = ctx.repo.apps[0];
    const code = await ctx.service.createAuthorizationCode(
      app.id,
      'user-1',
      'org-1',
      { codeChallenge: challenge, redirectUri: CLAUDE }
    );
    return { ...ctx, code };
  };

  it('exchanges the code with the right verifier, no secret, token only', async () => {
    const { service, reg, code } = await issue();
    const res = await service.exchangeCodeForToken(code, reg.client_id, undefined, {
      codeVerifier: verifier,
      redirectUri: CLAUDE,
    });
    expect(res.access_token).toMatch(/^pos_/);
    expect(res).not.toHaveProperty('cus');
    expect(res).not.toHaveProperty('id');
  });

  it('refuses a wrong or missing verifier', async () => {
    const { service, reg, code } = await issue();
    await expect(
      service.exchangeCodeForToken(code, reg.client_id, undefined, {
        codeVerifier: 'b'.repeat(50),
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.exchangeCodeForToken(code, reg.client_id, undefined, {})
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a different redirect_uri at the token endpoint', async () => {
    const { service, reg, code } = await issue();
    await expect(
      service.exchangeCodeForToken(code, reg.client_id, undefined, {
        codeVerifier: verifier,
        redirectUri: 'https://evil.com/cb',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('OAuthService for an app a workspace created', () => {
  const legacy = () => {
    const repo = makeRepo();
    repo.apps.push({
      id: 'app-legacy',
      clientId: 'pca_legacy',
      clientSecret: AuthService.fixedEncryption('pcs_secret'),
      redirectUrl: 'https://partner.example/cb',
      redirectUris: [],
      isPublic: false,
      deletedAt: null,
    });
    return { repo, service: new OAuthService(repo as any) };
  };

  it('keeps its single redirect URL and needs no PKCE', async () => {
    const { service } = legacy();
    const ok = await service.checkAuthorizationRequest('pca_legacy', {});
    expect(ok.redirectUri).toBe('https://partner.example/cb');
  });

  it('still needs its secret and returns the same fields as before', async () => {
    const { service } = legacy();
    const code = await service.createAuthorizationCode('app-legacy', 'u', 'org-1');
    await expect(
      service.exchangeCodeForToken(code, 'pca_legacy', undefined)
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.exchangeCodeForToken(code, 'pca_legacy', 'pcs_secreT')
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.exchangeCodeForToken(code, 'pca_legacy', 'pcs_secret_longer')
    ).rejects.toMatchObject({ status: 401 });
    const res = await service.exchangeCodeForToken(code, 'pca_legacy', 'pcs_secret');
    expect(res).toMatchObject({ id: 'org-1', cus: 'cus_1', token_type: 'bearer' });
  });
});
