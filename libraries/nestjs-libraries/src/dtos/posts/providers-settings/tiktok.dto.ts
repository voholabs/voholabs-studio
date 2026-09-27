import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsString,
  MaxLength,
  IsOptional,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

// TikTok's Content Sharing Guidelines: branded content can only be public or
// friends, never "only me".
@ValidatorConstraint({ name: 'tiktokBrandedNotPrivate' })
class BrandedContentNotPrivate implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments) {
    const o = args.object as TikTokDto;
    return !(o.brand_content_toggle && value === 'SELF_ONLY');
  }
  defaultMessage() {
    return 'Branded content visibility cannot be set to private.';
  }
}

// With the disclosure toggle on, at least one of "Your brand" / "Branded
// content" must be chosen before the post can go out.
@ValidatorConstraint({ name: 'tiktokDisclosureChosen' })
class DisclosureChosen implements ValidatorConstraintInterface {
  validate(value: boolean, args: ValidationArguments) {
    const o = args.object as TikTokDto;
    return !value || !!o.brand_organic_toggle || !!o.brand_content_toggle;
  }
  defaultMessage() {
    return 'You need to indicate if your content promotes yourself, a third party, or both.';
  }
}

// Set by the post page from TikTok's live creator info when this account
// can't post right now or the video is longer than it allows. Any value
// blocks the post, with that value as the reason shown to the user.
@ValidatorConstraint({ name: 'tiktokCreatorCheck' })
class CreatorCheckPassed implements ValidatorConstraintInterface {
  validate(value: string) {
    return !value;
  }
  defaultMessage(args: ValidationArguments) {
    return String(args.value);
  }
}

export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  title: string;

  // Chosen by the user from the creator's own options, with no default.
  // Upload-to-inbox posts leave it to the TikTok app.
  @ValidateIf((p) => p.content_posting_method !== 'UPLOAD')
  @Validate(BrandedContentNotPrivate)
  @IsIn([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
  ])
  @IsString()
  privacy_level:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  duet: boolean;

  @IsBoolean()
  stitch: boolean;

  @IsBoolean()
  comment: boolean;

  @IsIn(['yes', 'no'])
  autoAddMusic: 'yes' | 'no';

  @IsBoolean()
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  video_made_with_ai: boolean;

  @IsBoolean()
  brand_organic_toggle: boolean;

  @IsOptional()
  @IsBoolean()
  @Validate(DisclosureChosen)
  disclose?: boolean;

  @IsOptional()
  @Validate(CreatorCheckPassed)
  creator_check?: string;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';
}
