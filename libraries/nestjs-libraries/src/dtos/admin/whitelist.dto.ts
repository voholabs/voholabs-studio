import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class WhitelistDto {
  @IsOptional()
  @IsString()
  org?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Empty means forever
  @IsOptional()
  @IsNumber()
  @Min(1)
  days?: number;

  @IsOptional()
  @IsBoolean()
  remove?: boolean;

  // One off backfill: whitelist every organization that exists right now
  @IsOptional()
  @IsBoolean()
  allExisting?: boolean;
}
