import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoOptionsTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@gitroom/nestjs-libraries/chat/tools/video.function.tool';
import { GenerateVideoTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.tool';
import { GenerateImageTool } from '@gitroom/nestjs-libraries/chat/tools/generate.image.tool';
import { AccountInfoTool } from '@gitroom/nestjs-libraries/chat/tools/account.info.tool';
import { IntegrationListTool } from '@gitroom/nestjs-libraries/chat/tools/integration.list.tool';
import { GroupListTool } from '@gitroom/nestjs-libraries/chat/tools/group.list.tool';
import { UploadFromUrlTool } from '@gitroom/nestjs-libraries/chat/tools/upload.from.url.tool';
import { PostsListTool } from '@gitroom/nestjs-libraries/chat/tools/posts.list.tool';
import { PostsDeleteTool } from '@gitroom/nestjs-libraries/chat/tools/posts.delete.tool';
import { FindSlotTool } from '@gitroom/nestjs-libraries/chat/tools/find.slot.tool';
import { MediaListTool } from '@gitroom/nestjs-libraries/chat/tools/media.list.tool';
import { MediaDeleteTool } from '@gitroom/nestjs-libraries/chat/tools/media.delete.tool';
import { MediaUploadTool } from '@gitroom/nestjs-libraries/chat/tools/media.upload.tool';
import { MediaUploadLinkTool } from '@gitroom/nestjs-libraries/chat/tools/media.upload.link.tool';

export const toolList = [
  AccountInfoTool,
  IntegrationListTool,
  GroupListTool,
  IntegrationValidationTool,
  IntegrationTriggerTool,
  IntegrationSchedulePostTool,
  PostsListTool,
  PostsDeleteTool,
  FindSlotTool,
  MediaListTool,
  MediaDeleteTool,
  MediaUploadTool,
  MediaUploadLinkTool,
  GenerateVideoOptionsTool,
  VideoFunctionTool,
  GenerateVideoTool,
  GenerateImageTool,
  UploadFromUrlTool,
];
