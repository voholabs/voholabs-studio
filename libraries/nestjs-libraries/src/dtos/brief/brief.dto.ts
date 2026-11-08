import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  BRIEF_ASSET_NAME_MAX,
  BRIEF_ASSET_NOTE_MAX,
  BRIEF_ASSET_URL_MAX,
  BRIEF_ASSETS_MAX,
  BRIEF_BLOCK_ID_MAX,
  BRIEF_BLOCKS_MAX,
  BRIEF_BODY_MAX,
  BRIEF_HEADING_MAX,
  BRIEF_LINK_ID_MAX,
  BRIEF_LINK_NOTE_MAX,
  BRIEF_LINK_URL_MAX,
  BRIEF_LINKS_MAX,
  BRIEF_TITLE_MAX,
  BRIEF_KIT_COLOR_ROLES,
  BRIEF_KIT_FONT_FAMILY_MAX,
  BRIEF_KIT_FONT_ROLES,
  BRIEF_KIT_IMAGERY_MAX,
  BRIEF_KIT_LOGO_VARIANTS,
} from '@gitroom/nestjs-libraries/agent-brief/brief.registry';

export class BriefBlockDto {
  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_BLOCK_ID_MAX)
  id: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_HEADING_MAX)
  heading: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_BODY_MAX)
  body: string;
}

export class BriefLinkDto {
  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_LINK_ID_MAX)
  id: string;

  // Length-capped but not format-checked: autosave fires while the user is
  // still halfway through typing a URL, and rejecting that would lose the
  // keystrokes. Nothing fetches these links, they are read as text.
  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_LINK_URL_MAX)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRIEF_LINK_NOTE_MAX)
  note?: string;
}

export class BriefAssetDto {
  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_BLOCK_ID_MAX)
  id: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_ASSET_NAME_MAX)
  name: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_ASSET_URL_MAX)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRIEF_ASSET_NOTE_MAX)
  note?: string;
}

// The roles, the hex digits and the font family are checked by BriefService
// rather than here, so the public API and the agent's briefSaveTool get the
// same "Not saved: ..." wording. These only bound the size of what arrives.
export class BriefKitColorDto {
  @IsString()
  @IsDefined()
  @MaxLength(20)
  role: string;

  @IsString()
  @IsDefined()
  @MaxLength(20)
  hex: string;
}

export class BriefKitFontDto {
  @IsString()
  @IsDefined()
  @MaxLength(20)
  role: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_KIT_FONT_FAMILY_MAX)
  family: string;
}

export class BriefKitLogoDto {
  @IsString()
  @IsDefined()
  @MaxLength(20)
  variant: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRIEF_ASSET_URL_MAX)
  url: string;
}

// Each field sent replaces that field of the stored kit; a field left out
// keeps what is stored.
export class BriefKitDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_KIT_COLOR_ROLES.length)
  @ValidateNested({ each: true })
  @Type(() => BriefKitColorDto)
  colors?: BriefKitColorDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_KIT_FONT_ROLES.length)
  @ValidateNested({ each: true })
  @Type(() => BriefKitFontDto)
  fonts?: BriefKitFontDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_KIT_LOGO_VARIANTS.length)
  @ValidateNested({ each: true })
  @Type(() => BriefKitLogoDto)
  logos?: BriefKitLogoDto[];

  @IsOptional()
  @IsString()
  @MaxLength(BRIEF_KIT_IMAGERY_MAX)
  imagery?: string;
}

// Blocks and links are ordered lists, so each is replaced whole rather than
// merged; a field that is absent is left exactly as it was stored.
export class SaveBriefDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(BRIEF_TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_BLOCKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BriefBlockDto)
  blocks?: BriefBlockDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_LINKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BriefLinkDto)
  links?: BriefLinkDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRIEF_ASSETS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BriefAssetDto)
  assets?: BriefAssetDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BriefKitDto)
  kit?: BriefKitDto;
}

export class StartBriefOnboardingDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  lang?: string;
}
