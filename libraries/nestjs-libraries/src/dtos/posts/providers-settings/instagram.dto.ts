import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class Collaborators {
  @IsDefined()
  @IsString()
  label: string;
}

export class InstagramAudio {
  @IsDefined()
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  audio_volume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  video_volume?: number;
}
export class InstagramDto {
  @IsIn(['post', 'story'])
  @IsDefined()
  post_type: 'post' | 'story';

  // No @IsBoolean: existing callers may send "true"/"false", which the
  // providers read with assetBoolean
  @IsOptional()
  @JSONSchema({
    type: 'boolean',
    description:
      'Publish the Reel as a Trial Reel: Instagram shows it to non-followers first. Only for a Reel (post_type post with exactly one video), a carousel or a picture is rejected, and it is ignored for a story. Defaults to false',
  })
  is_trial_reel?: boolean;

  @IsIn(['MANUAL', 'SS_PERFORMANCE'])
  @IsOptional()
  @JSONSchema({
    description:
      'Only used when is_trial_reel is true. MANUAL = the Trial Reel stays with non-followers until it is shared to followers by hand in the Instagram app. SS_PERFORMANCE = Instagram shares it to followers automatically if it performs well. Defaults to MANUAL',
  })
  graduation_strategy?: 'MANUAL' | 'SS_PERFORMANCE';

  @Type(() => Collaborators)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  collaborators: Collaborators[];

  @Type(() => InstagramAudio)
  @ValidateNested()
  @IsOptional()
  audio?: InstagramAudio;
}
