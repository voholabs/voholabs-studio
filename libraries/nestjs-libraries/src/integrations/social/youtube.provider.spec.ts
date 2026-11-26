// When the thumbnail of an uploaded video is set: YouTube only shows a custom
// thumbnail on a Short if it arrives after the video finished processing.
import 'reflect-metadata';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

const list = jest.fn();
const set = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {
          return;
        }
      },
    },
    youtube: () => ({ videos: { list }, thumbnails: { set } }),
  },
}));

jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetchStream: async () => ({ stream: 'image' }),
}));

jest.mock('@gitroom/nestjs-libraries/temporal/temporal.heartbeat', () => ({
  setHeartbeatDetails: () => undefined,
}));

const integration = { id: 'i1', organizationId: 'org' } as any;
const uploaded = {
  uploadUri: 'https://upload',
  videoSize: 10,
  path: 'https://media/video.mp4',
  uploadedBytes: 10,
  thumbnail: 'https://media/thumb.jpg',
  videoId: 'vid',
  postDbId: 'post',
};
const processing = (processingStatus?: string) => ({
  data: { items: [{ processingDetails: { processingStatus } }] },
});
const completed = {
  status: 'completed',
  postId: 'vid',
  releaseURL: 'https://www.youtube.com/watch?v=vid',
};

describe('YoutubeProvider setting the thumbnail', () => {
  const provider = new YoutubeProvider();

  beforeEach(() => {
    list.mockReset();
    set.mockReset().mockResolvedValue({});
  });

  it('waits while the video is processing', async () => {
    list.mockResolvedValue(processing('processing'));
    const result: any = await provider.finalizePost('t', uploaded, integration);

    expect(result.status).toBe('pending');
    expect(result.pendingData.videoId).toBe('vid');
    expect(result.pendingData.thumbnailWaitFrom).toEqual(expect.any(Number));
    expect(set).not.toHaveBeenCalled();
  });

  it('sets it once the video is processed', async () => {
    list.mockResolvedValue(processing('succeeded'));
    await expect(
      provider.finalizePost('t', uploaded, integration)
    ).resolves.toEqual(completed);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('stops waiting after the limit', async () => {
    list.mockResolvedValue(processing('processing'));
    await expect(
      provider.finalizePost(
        't',
        { ...uploaded, thumbnailWaitFrom: Date.now() - 6 * 60 * 1000 },
        integration
      )
    ).resolves.toEqual(completed);
    expect(list).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('sets it anyway when the processing check fails', async () => {
    list.mockRejectedValue(new Error('forbidden'));
    await expect(
      provider.finalizePost('t', uploaded, integration)
    ).resolves.toEqual(completed);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('does not wait on the blocking path of old workflows', async () => {
    await expect(
      provider.finalizePost(
        't',
        { ...uploaded, thumbnailNoWait: true },
        integration
      )
    ).resolves.toEqual(completed);
    expect(list).not.toHaveBeenCalled();
  });

  it('leaves a video without a thumbnail alone', async () => {
    await expect(
      provider.finalizePost('t', { ...uploaded, thumbnail: '' }, integration)
    ).resolves.toEqual(completed);
    expect(list).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('hands a waiting video back to finalizePost', async () => {
    await expect(
      provider.checkPostStatus('t', uploaded, integration)
    ).resolves.toEqual({ status: 'ready', pendingData: uploaded });
  });
});
