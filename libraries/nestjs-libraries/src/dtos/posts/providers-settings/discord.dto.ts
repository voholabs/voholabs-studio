import {
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class DiscordDto {
  @MinLength(1)
  @IsDefined()
  @IsString()
    @JSONSchema({
    description: 'Channel must be an id',
  })
  channel: string;

  // Optional, so every post saved before this existed keeps validating and
  // normal channels are unaffected. Only forum channels need a title, and even
  // there the first line of the post is used when it is left empty.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @JSONSchema({
    description:
      'Only for forum channels, where every post is a thread that needs a title (max 100 characters). Leave empty to use the first line of the post. Ignored by text and announcement channels.',
  })
  title?: string;
}
