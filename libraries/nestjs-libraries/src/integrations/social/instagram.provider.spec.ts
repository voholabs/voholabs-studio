// Trial Reels: trial_params goes only on a single-video REELS container, on
// both Instagram providers, and the setting is described to the agent.
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';

const video = { path: 'https://cdn.example.com/clip.mp4' } as any;
const picture = { path: 'https://cdn.example.com/photo.jpg' } as any;
const integration = { profile: 'voholabs' } as any;

describe.each([
  ['instagram', () => new InstagramProvider()],
  ['instagram-standalone', () => new InstagramStandaloneProvider()],
])('%s Trial Reels validation', (_name, make) => {
  const provider = make();

  it('accepts a single video as a Trial Reel', async () => {
    await expect(
      provider.checkValidity([[video]], {
        post_type: 'post',
        is_trial_reel: true,
      })
    ).resolves.toBe(true);
  });

  it('rejects a carousel or a picture', async () => {
    await expect(
      provider.checkValidity([[video, video]], {
        post_type: 'post',
        is_trial_reel: true,
      })
    ).resolves.toBe('Trial Reels can only have one video');
    await expect(
      provider.checkValidity([[picture]], {
        post_type: 'post',
        is_trial_reel: 'true',
      })
    ).resolves.toBe('Trial Reels must be a video');
  });

  it('ignores the setting on a story', async () => {
    await expect(
      provider.checkValidity([[picture]], {
        post_type: 'story',
        is_trial_reel: true,
      })
    ).resolves.toBe(true);
  });
});

describe('InstagramProvider Trial Reels container', () => {
  const provider = new InstagramProvider();
  let urls: string[];

  beforeEach(() => {
    urls = [];
    jest.spyOn(provider, 'fetch').mockImplementation(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ id: 'container' }));
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const publish = (settings: any, media: any[]) =>
    provider.postPending(
      'ig-user',
      'token',
      [{ id: 'p1', message: 'hi', settings, media } as any],
      integration
    );

  const trialParams = (url: string) =>
    new URL(url).searchParams.get('trial_params');

  it('sends trial_params with the chosen graduation strategy on a Reel', async () => {
    await publish(
      {
        post_type: 'post',
        is_trial_reel: true,
        graduation_strategy: 'SS_PERFORMANCE',
      },
      [video]
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('media_type=REELS');
    expect(JSON.parse(trialParams(urls[0])!)).toEqual({
      graduation_strategy: 'SS_PERFORMANCE',
    });
  });

  it('defaults the graduation strategy to MANUAL', async () => {
    await publish({ post_type: 'post', is_trial_reel: 'true' }, [video]);
    expect(JSON.parse(trialParams(urls[0])!)).toEqual({
      graduation_strategy: 'MANUAL',
    });
  });

  it('sends no trial_params when off, on a story or on a carousel', async () => {
    await publish({ post_type: 'post', is_trial_reel: false }, [video]);
    await publish({ post_type: 'story', is_trial_reel: true }, [video]);
    await publish({ post_type: 'post', is_trial_reel: true }, [video, video]);
    // one container each for the first two, one per item for the carousel
    expect(urls).toHaveLength(4);
    urls.forEach((url) => expect(trialParams(url)).toBeNull());
  });
});

describe('InstagramDto schema for the agent', () => {
  it('describes the Trial Reel settings', () => {
    const { properties } = getValidationSchemas().InstagramDto as any;
    expect(properties.is_trial_reel.type).toBe('boolean');
    expect(properties.is_trial_reel.description).toContain('Trial Reel');
    expect(properties.graduation_strategy.enum).toEqual([
      'MANUAL',
      'SS_PERFORMANCE',
    ]);
    expect(properties.graduation_strategy.description).toContain(
      'SS_PERFORMANCE'
    );
  });
});
