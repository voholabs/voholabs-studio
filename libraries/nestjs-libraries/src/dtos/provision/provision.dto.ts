import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionLookupDto {
  @IsEmail()
  @IsDefined()
  email: string;
}

export class ProvisionCreateDto {
  @IsEmail()
  @IsDefined()
  email: string;

  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(128)
  company: string;

  @IsString()
  @IsDefined()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  // When access should lapse. Required: this endpoint exists to mirror somebody
  // else's billing period, and an open-ended grant is exactly what it must not
  // create.
  @IsISO8601()
  @IsDefined()
  activeUntil: string;
}

export class ProvisionAccessDto {
  @IsString()
  @IsDefined()
  orgId: string;

  @IsOptional()
  @IsISO8601()
  activeUntil?: string;

  @IsOptional()
  @IsBoolean()
  revoke?: boolean;
}

export class ProvisionSessionDto {
  @IsString()
  @IsDefined()
  orgId: string;
}
