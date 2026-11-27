// What the post screen learns about a TikTok account: an expired access token
// is renewed by the caller, a posting limit is reported as it is.
import 'reflect-metadata';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe('TiktokProvider creator info', () => {
  const provider = new TiktokProvider();
  const fetchMock = jest.spyOn(global, 'fetch');

  afterAll(() => fetchMock.mockRestore());

  it('reads the account when TikTok answers ok', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, {
        data: {
          creator_nickname: 'Shop',
          privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
        },
        error: { code: 'ok' },
      })
    );
    await expect(provider.creatorInfo('t')).resolves.toMatchObject({
      canPost: true,
      errorCode: null,
      nickname: 'Shop',
      privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    });
  });

  it('asks for a new token when the access token expired', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(401, { error: { code: 'access_token_invalid' } })
    );
    await expect(provider.creatorInfo('t')).rejects.toBeInstanceOf(
      RefreshToken
    );
  });

  it('reports a posting limit as before', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, { error: { code: 'spam_risk_too_many_posts' } })
    );
    await expect(provider.creatorInfo('t')).resolves.toMatchObject({
      canPost: false,
      errorCode: 'spam_risk_too_many_posts',
      privacyLevelOptions: [],
    });
  });
});
