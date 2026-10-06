import { HttpException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  createWidgetUpload,
  deleteStoredObject,
  signWidgetPart,
  storedObjectSize,
  widgetPartCount,
  widgetPartLength,
  WIDGET_PART_BYTES,
} from '@gitroom/nestjs-libraries/upload/r2.uploader';
import { getMaxSize } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { generationError } from '@gitroom/nestjs-libraries/openai/generation.error';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { Organization } from '@prisma/client';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { planOf } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/trial';
import { WalletStorageService } from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.storage.service';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@Injectable()
export class MediaService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _mediaRepository: MediaRepository,
    private _openAi: OpenaiService,
    private _subscriptionService: SubscriptionService,
    private _videoManager: VideoManager,
    private _walletStorage: WalletStorageService
  ) {}

  async deleteMedia(org: string, id: string) {
    return this._mediaRepository.deleteMedia(org, id);
  }

  getMediaById(id: string) {
    return this._mediaRepository.getMediaById(id);
  }

  getMediaByIdsForOrg(org: string, ids: string[]) {
    return this._mediaRepository.getMediaByIdsForOrg(org, ids);
  }

  // Upload widget (MCP Apps). The session id is what the model sees and polls;
  // the ticket is the credential the widget uploads with, handed to the widget
  // only so it stays out of the conversation. A ticket never outlives its
  // session.
  async createUploadSession(org: string) {
    const sessionId = randomBytes(16).toString('hex');
    await ioRedis.set(`uploadSession:${sessionId}`, org, 'EX', 6 * 3600);
    return sessionId;
  }

  private async checkUploadSession(org: string, sessionId: string) {
    if ((await ioRedis.get(`uploadSession:${sessionId}`)) !== org) {
      throw new HttpException('Upload session not found or expired', 404);
    }
  }

  async createUploadTicket(org: string, sessionId: string) {
    await this.checkUploadSession(org, sessionId);
    const ticket = randomBytes(32).toString('hex');
    // Long enough to sign every part of a 1 GB video on a slow connection.
    await ioRedis.set(
      `uploadTicket:${ticket}`,
      JSON.stringify({ org, sessionId }),
      'EX',
      3 * 3600
    );
    return ticket;
  }

  async getUploadTicket(ticket: string) {
    const found = JSON.parse(
      (await ioRedis.get(`uploadTicket:${ticket}`)) || 'null'
    ) as { org: string; sessionId: string } | null;
    if (
      !found ||
      (await ioRedis.get(`uploadSession:${found.sessionId}`)) !== found.org
    ) {
      return null;
    }
    return found;
  }

  // Starts an upload box upload. The announced size is checked against the
  // file type's limit and the storage allowance before anything is stored, and
  // recorded with the upload so each part can only be signed for its share of
  // it (signUploadSessionPart).
  async startUploadSessionFile(
    org: string,
    sessionId: string,
    file: { name?: string; size?: number; type?: string }
  ) {
    await this.checkUploadSession(org, sessionId);
    const size = Math.floor(Number(file?.size) || 0);
    if (size <= 0) {
      throw new HttpException('The file is empty', 400);
    }
    const name = (file?.name || '').toLowerCase();
    const mime =
      name.endsWith('.mp4') || name.endsWith('.mov') ? 'video/mp4' : 'image/png';
    if (size > getMaxSize(mime)) {
      throw new HttpException('File is too large.', 400);
    }
    await this.assertStorage(org, size, { charge: false });

    const created = await createWidgetUpload(file?.name || '');
    if (!created) {
      throw new HttpException('Unsupported file type.', 400);
    }
    await ioRedis.set(
      `uploadPart:${created.uploadId}`,
      JSON.stringify({ org, sessionId, key: created.key, size }),
      'EX',
      6 * 3600
    );
    return { ...created, partSize: WIDGET_PART_BYTES };
  }

  // The upload as recorded at its start, refused for any other workspace.
  async uploadSessionPart(org: string, uploadId: string) {
    const found = JSON.parse(
      (await ioRedis.get(`uploadPart:${uploadId}`)) || 'null'
    ) as { org: string; sessionId: string; key: string; size: number } | null;
    if (!found || found.org !== org) {
      throw new HttpException('Upload not found or expired', 404);
    }
    return found;
  }

  async signUploadSessionPart(
    org: string,
    uploadId: string,
    partNumber: number
  ) {
    const upload = await this.uploadSessionPart(org, uploadId);
    if (
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > widgetPartCount(upload.size)
    ) {
      throw new HttpException('Invalid part', 400);
    }
    return {
      url: await signWidgetPart(
        upload.key,
        uploadId,
        partNumber,
        widgetPartLength(upload.size, partNumber)
      ),
    };
  }

  // A file the widget put straight into the bucket: sized from the bucket,
  // checked against the storage allowance (and paid for from a wallet) like
  // every other upload, then added to the library and to the session.
  async saveUploadSessionFile(
    org: string,
    sessionId: string,
    location: string,
    originalName?: string
  ) {
    await this.checkUploadSession(org, sessionId);
    const name = location.split('/').pop()!;
    const size = await storedObjectSize(name);
    try {
      await this.assertStorage(org, size);
    } catch (err) {
      await deleteStoredObject(name);
      throw err;
    }
    const media = await this.saveFile(
      org,
      name,
      location,
      originalName || undefined,
      size
    );
    await ioRedis.rpush(`uploadSessionMedia:${sessionId}`, media.id);
    await ioRedis.expire(`uploadSessionMedia:${sessionId}`, 6 * 3600);
    return media;
  }

  async getUploadSession(org: string, sessionId: string) {
    await this.checkUploadSession(org, sessionId);
    const ids = await ioRedis.lrange(`uploadSessionMedia:${sessionId}`, 0, -1);
    return this.getMediaByIdsForOrg(org, ids);
  }

  getMediaByPathsForOrg(org: string, paths: string[]) {
    return this._mediaRepository.getMediaByPathsForOrg(org, paths);
  }

  async generateImage(
    prompt: string,
    org: Organization,
    generatePromptFirst?: boolean
  ) {
    try {
      const generating = await this._subscriptionService.useCredit(
        org,
        'ai_images',
        async () => {
          if (generatePromptFirst) {
            prompt = await this._openAi.generatePromptForPicture(prompt);
            console.log('Prompt:', prompt);
          }
          return this._openAi.generateImage(prompt);
        }
      );

      return generating;
    } catch (err) {
      throw generationError(err);
    }
  }

  async saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    fileSize?: number,
    type?: string
  ) {
    return this._mediaRepository.saveFile(
      org,
      fileName,
      filePath,
      originalName,
      fileSize,
      type
    );
  }

  // Bytes the organization may still upload. The usage is the sum of what is
  // in its media library, so there is no counter to keep in step. Files saved
  // before sizes were recorded count as zero. A free-plan organization that
  // pays from its wallet has no cap: storage above the free amount is paid
  // for when it is uploaded instead (see assertStorage).
  async storageLeft(org: string) {
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(org);
    if (await this.paysStorageFromWallet(org, subscription)) {
      return Number.POSITIVE_INFINITY;
    }
    return this.planStorageLeft(org, subscription);
  }

  private async planStorageLeft(
    org: string,
    subscription: Parameters<typeof planOf>[0]
  ) {
    const limit = pricing[planOf(subscription)].storage_mb * 1024 * 1024;
    return limit - (await this._mediaRepository.getStorageUsed(org));
  }

  private async paysStorageFromWallet(
    org: string,
    subscription: Parameters<typeof planOf>[0]
  ) {
    return (
      planOf(subscription) === 'FREE' &&
      (await this._walletStorage.liftsCap(org))
    );
  }

  // Call before the bytes go to storage, so a refused file is never stored.
  // A free-plan organization that pays from its wallet pays here for any
  // storage unit above the free amount the file takes it into (a 402 when it
  // cannot); `charge: false` only checks it could pay, for a size announced
  // before the file arrives. Everyone else is held to the plan's cap (413).
  async assertStorage(
    org: string,
    incomingBytes: number,
    options: { charge?: boolean } = {}
  ) {
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(org);
    if (await this.paysStorageFromWallet(org, subscription)) {
      await this._walletStorage.payForUpload(org, incomingBytes, options);
      return;
    }
    if (
      (incomingBytes || 0) > (await this.planStorageLeft(org, subscription))
    ) {
      const message =
        'Your media library is full. Delete files you no longer need, or upgrade for more storage.';
      throw new HttpException({ msg: message, message }, 413);
    }
  }

  getMedia(org: string, page: number, search?: string) {
    return this._mediaRepository.getMedia(org, page, search);
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._mediaRepository.saveMediaInformation(org, data);
  }

  getVideoOptions() {
    return this._videoManager.getAllVideos();
  }

  async generateVideoAllowed(org: Organization, type: string) {
    const video = this._videoManager.getVideoByName(type);
    if (!video) {
      throw new Error(`Video type ${type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    return true;
  }

  async generateVideo(org: Organization, body: VideoDto) {
    try {
      const totalCredits = await this._subscriptionService.checkCredits(
        org,
        'ai_videos'
      );

      if (totalCredits.credits <= 0) {
        throw new SubscriptionException({
          action: AuthorizationActions.Create,
          section: Sections.VIDEOS_PER_MONTH,
        });
      }

      const video = this._videoManager.getVideoByName(body.type);
      if (!video) {
        throw new Error(`Video type ${body.type} not found`);
      }

      if (!video.trial && org.isTrailing) {
        throw new HttpException(
          'This video is not available in trial mode',
          406
        );
      }

      console.log(body.customParams);
      await video.instance.processAndValidate(body.customParams);
      console.log('no err');

      return await this._subscriptionService.useCredit(
        org,
        'ai_videos',
        async () => {
          const loadedData = await video.instance.process(
            body.output,
            body.customParams
          );

          const file = await this.storage.uploadSimple(loadedData);
          return this.saveFile(org.id, file.split('/').pop(), file);
        }
      );
    } catch (err) {
      throw generationError(err);
    }
  }

  async videoFunction(identifier: string, functionName: string, body: any) {
    const video = this._videoManager.getVideoByName(identifier);
    if (!video) {
      throw new Error(`Video with identifier ${identifier} not found`);
    }

    // @ts-ignore
    const functionToCall = video.instance[functionName];
    if (
      typeof functionToCall !== 'function' ||
      this._videoManager.checkAvailableVideoFunction(functionToCall)
    ) {
      throw new HttpException(
        `Function ${functionName} not found on video instance`,
        400
      );
    }

    return functionToCall(body);
  }
}
