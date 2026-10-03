import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class WalletCheckoutDto {
  // The minimum is a billing setting, checked by the service.
  @IsInt()
  @Min(1)
  @Max(100000)
  pence: number;

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
  amountPence?: number;

  @IsInt()
  @Min(0)
  @Max(1000000)
  @IsOptional()
  monthlyCapPence?: number;
}
