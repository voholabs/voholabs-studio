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
// A Voho library flow id.
export const USER_FLOW_LIBRARY_ID = /^[A-Za-z0-9._-]+$/;
// What a custom flow is based on: a library flow id or "my/<slug>".
export const USER_FLOW_BASED_ON =
  /^(?:my\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|[A-Za-z0-9._-]+)$/;
export const USER_FLOW_BASED_ON_MAX = 100;
export const USER_FLOW_CUSTOMIZATION_MAX = 20_000;
export const USER_FLOW_SKILLS_MAX = 5;
export const USER_FLOW_SKILL_SLUG_MAX = 128;
// How many of My flows a chain of bases may run through.
export const USER_FLOW_CHAIN_MAX = 5;

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

  // The flow this one is based on: a library flow id or "my/<slug>"; null
  // makes it a flow of its own again.
  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_BASED_ON_MAX)
  @Matches(USER_FLOW_BASED_ON)
  basedOn?: string | null;

  // What changes or adds to the base method.
  @IsOptional()
  @IsString()
  @MaxLength(USER_FLOW_CUSTOMIZATION_MAX)
  customization?: string;

  // Skill slugs from the skills library.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(USER_FLOW_SKILLS_MAX)
  @IsString({ each: true })
  @MaxLength(USER_FLOW_SKILL_SLUG_MAX, { each: true })
  skills?: string[];
}

// Forking a Voho library flow into My flows.
export class ForkUserFlowDto {
  @IsString()
  @IsDefined()
  @MaxLength(USER_FLOW_LIBRARY_ID_MAX)
  @Matches(USER_FLOW_LIBRARY_ID)
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
