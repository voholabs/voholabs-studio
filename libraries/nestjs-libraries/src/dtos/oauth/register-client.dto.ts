import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Dynamic client registration (RFC 7591). Only the fields Studio uses are
// declared; the rest of the request is ignored.
export class RegisterClientDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  redirect_uris: string[];

  @IsString()
  @IsOptional()
  @MaxLength(200)
  client_name?: string;
}
