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
  BRAIN_ASSET_NAME_MAX,
  BRAIN_ASSET_NOTE_MAX,
  BRAIN_ASSET_URL_MAX,
  BRAIN_ASSETS_MAX,
  BRAIN_BLOCK_ID_MAX,
  BRAIN_BLOCKS_MAX,
  BRAIN_BODY_MAX,
  BRAIN_HEADING_MAX,
  BRAIN_LINK_ID_MAX,
  BRAIN_LINK_NOTE_MAX,
  BRAIN_LINK_URL_MAX,
  BRAIN_LINKS_MAX,
  BRAIN_TITLE_MAX,
} from '@gitroom/nestjs-libraries/agent-brain/brain.registry';

export class BrainBlockDto {
  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_BLOCK_ID_MAX)
  id: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_HEADING_MAX)
  heading: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_BODY_MAX)
  body: string;
}

export class BrainLinkDto {
  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_LINK_ID_MAX)
  id: string;

  // Length-capped but not format-checked: autosave fires while the user is
  // still halfway through typing a URL, and rejecting that would lose the
  // keystrokes. Nothing fetches these links, they are read as text.
  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_LINK_URL_MAX)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRAIN_LINK_NOTE_MAX)
  note?: string;
}

export class BrainAssetDto {
  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_BLOCK_ID_MAX)
  id: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_ASSET_NAME_MAX)
  name: string;

  @IsString()
  @IsDefined()
  @MaxLength(BRAIN_ASSET_URL_MAX)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BRAIN_ASSET_NOTE_MAX)
  note?: string;
}

// Blocks and links are ordered lists, so each is replaced whole rather than
// merged; a field that is absent is left exactly as it was stored.
export class SaveBrainDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(BRAIN_TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRAIN_BLOCKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BrainBlockDto)
  blocks?: BrainBlockDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRAIN_LINKS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BrainLinkDto)
  links?: BrainLinkDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BRAIN_ASSETS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BrainAssetDto)
  assets?: BrainAssetDto[];
}
