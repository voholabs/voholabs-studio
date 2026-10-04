import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class WalletCheckoutDto {
  // The minimum is a billing setting, checked by the service.
  @IsInt()
  @Min(1)
  @Max(100000)
  amount: number;

  @IsBoolean()
  @IsOptional()
  saveCard?: boolean;
}

export class WalletAutoTopUpDto {
  @IsBoolean()
  enabled: boolean;

  // Hundredths of a credit.
  @IsInt()
  @Min(0)
  @IsOptional()
  threshold?: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  @IsOptional()
  amount?: number;

  @IsInt()
  @Min(0)
  @Max(1000000)
  @IsOptional()
  monthlyCap?: number;
}

export class WalletEstimateDto {
  // A provider identifier, e.g. "x".
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  provider: string;

  // The post first, then each reply, as stored (HTML or text).
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100000, { each: true })
  contents: string[];
}
