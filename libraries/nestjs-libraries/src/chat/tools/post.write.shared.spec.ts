jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/chat/tools/media.upload.helper', () => ({
  storeUrlAsMedia: jest.fn(),
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  attachmentUrl,
  hostExternalAttachments,
  withPostLinks,
} from '@gitroom/nestjs-libraries/chat/tools/post.write.shared';
import { storeUrlAsMedia } from '@gitroom/nestjs-libraries/chat/tools/media.upload.helper';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import { AUDIO_ATTACHMENT_ERROR } from '@gitroom/helpers/utils/valid.url.path';

// The media library keeps mp3 audio for the agent, but no route lets one
// become a post attachment.
describe('audio as a post attachment', () => {
  it('is refused by the tools attachment schema, with the audio message', () => {
    const result = attachmentUrl.safeParse(
      'https://uploads.example.com/voice-over.mp3'
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(AUDIO_ATTACHMENT_ERROR);
  });

  it('still takes images and videos', () => {
    expect(attachmentUrl.safeParse('/uploads/a.png').success).toBe(true);
    expect(attachmentUrl.safeParse('/uploads/a.mp4?x=1').success).toBe(true);
  });

  it('is refused by the dashboard and public API media DTO', async () => {
    const errors = await validate(
      plainToInstance(MediaDto, { id: 'm1', path: '/uploads/voice-over.MP3' })
    );
    expect(errors[0].constraints?.checkValidExtension).toBe(
      AUDIO_ATTACHMENT_ERROR
    );
  });

  it('is refused when an external URL turns out to be audio', async () => {
    (storeUrlAsMedia as jest.Mock).mockResolvedValueOnce({
      error: AUDIO_ATTACHMENT_ERROR,
    });
    await expect(
      hostExternalAttachments({
        mediaService: {} as any,
        organizationId: 'org-1',
        paths: ['https://cdn.example.com/looks-like.png'],
      })
    ).rejects.toThrow(AUDIO_ATTACHMENT_ERROR);
    expect(storeUrlAsMedia).toHaveBeenCalledWith(
      expect.objectContaining({ postAttachment: true })
    );
  });
});

describe('audio inside post content', () => {
  it('drops an <img> that points at an audio file and keeps a picture', () => {
    const out = withPostLinks({
      content:
        '<p>a</p><img src="https://uploads.example.com/v.mp3"><img src="https://uploads.example.com/p.png">',
    });
    expect(out).not.toContain('v.mp3');
    expect(out).toContain('p.png');
  });
});
