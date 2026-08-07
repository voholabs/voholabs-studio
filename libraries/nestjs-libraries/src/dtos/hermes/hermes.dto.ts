import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const HERMES_MESSAGE_MAX = 100_000;
export const HERMES_HISTORY_MAX = 200;
export const HERMES_URL_MAX = 2048;
export const HERMES_KEY_MAX = 512;
export const HERMES_ATTACHMENT_MAX = 8_000_000;
export const HERMES_ATTACHMENTS_PER_MESSAGE = 6;

export class HermesAttachmentDto {
  @IsString()
  @IsDefined()
  @MaxLength(300)
  name: string;

  @IsString()
  @IsDefined()
  @MaxLength(200)
  mime: string;

  // A data: URL for an inline image. Held for the length of the request only —
  // attachments are never written to the conversation history.
  @IsOptional()
  @IsString()
  @MaxLength(HERMES_ATTACHMENT_MAX)
  data?: string;

  // Where a file that was uploaded rather than inlined can be fetched.
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}

export class HermesMessageDto {
  @IsString()
  @IsDefined()
  @IsIn(['system', 'user', 'assistant'])
  role: 'system' | 'user' | 'assistant';

  @IsString()
  @IsDefined()
  @MaxLength(HERMES_MESSAGE_MAX)
  content: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HERMES_ATTACHMENTS_PER_MESSAGE)
  @ValidateNested({ each: true })
  @Type(() => HermesAttachmentDto)
  attachments?: HermesAttachmentDto[];
}

export class HermesChatDto {
  @IsArray()
  @IsDefined()
  @ArrayMaxSize(HERMES_HISTORY_MAX)
  @ValidateNested({ each: true })
  @Type(() => HermesMessageDto)
  messages: HermesMessageDto[];
}

export class HermesSaveConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsArray()
  @IsDefined()
  @ArrayMaxSize(HERMES_HISTORY_MAX)
  @ValidateNested({ each: true })
  @Type(() => HermesMessageDto)
  messages: HermesMessageDto[];
}

export class HermesSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(HERMES_URL_MAX)
  url?: string;

  // Omitted keeps the stored key; an empty string clears it.
  @IsOptional()
  @IsString()
  @MaxLength(HERMES_KEY_MAX)
  apiKey?: string;

}
