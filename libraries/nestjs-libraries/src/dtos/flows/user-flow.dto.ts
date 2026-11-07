import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const USER_FLOW_SLUG_MAX = 64;
export const USER_FLOW_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const USER_FLOW_TITLE_MAX = 160;
export const USER_FLOW_TEXT_MAX = 1000;
export const USER_FLOW_BODY_MAX = 100_000;
export const USER_FLOW_CATEGORY_MAX = 40;
export const USER_FLOW_COST_MAX = 300;
export const USER_FLOW_LIST_MAX = 20;
export const USER_FLOW_LIST_ITEM_MAX = 200;
export const USER_FLOW_PARTS_MAX = 30;
export const USER_FLOW_PART_KEY_MAX = 64;
export const USER_FLOW_TOKEN_MAX = 100;
export const USER_FLOW_LIBRARY_ID_MAX = 100;

// Saving a flow from the app: a new one (POST, no slug or a free one) or an
// edit of an existing one (PATCH /user-flows/:slug). A field left out of an
// edit keeps what is stored.
export class SaveUserFlowDto {
  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_SLUG_MAX)
  @Matches(USER_FLOW_SLUG)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(USER_FLOW_TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_TEXT_MAX)
  whenToUse?: string;

  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_TEXT_MAX)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_BODY_MAX)
  body?: string;

  // Named parts of the method, { name: text }; checked in the service.
  @IsOptional()
  @IsObject()
  parts?: Record<string, string> | null;

  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_CATEGORY_MAX)
  category?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_COST_MAX)
  cost?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(USER_FLOW_LIST_MAX)
  @IsString({ each: true })
  @MaxLength(USER_FLOW_LIST_ITEM_MAX, { each: true })
  foundation?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(USER_FLOW_LIST_MAX)
  @IsString({ each: true })
  @MaxLength(USER_FLOW_LIST_ITEM_MAX, { each: true })
  brandSlots?: string[];
}

// Forking a Voho library flow into My flows.
export class ForkUserFlowDto {
  @IsString()
  @IsDefined()
  @MaxLength(USER_FLOW_LIBRARY_ID_MAX)
  @Matches(/^[A-Za-z0-9._-]+$/)
  id: string;

  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_SLUG_MAX)
  @Matches(USER_FLOW_SLUG)
  slug?: string;
}

// Importing a flow from a share link into My flows.
export class ImportUserFlowDto {
  @IsString()
  @IsDefined()
  @MaxLength(USER_FLOW_TOKEN_MAX)
  token: string;

  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_SLUG_MAX)
  @Matches(USER_FLOW_SLUG)
  slug?: string;
}
