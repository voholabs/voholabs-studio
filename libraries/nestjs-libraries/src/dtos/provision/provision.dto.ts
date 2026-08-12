import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';

export class ProvisionLookupDto {
  @IsEmail()
  @IsDefined()
  email: string;
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
