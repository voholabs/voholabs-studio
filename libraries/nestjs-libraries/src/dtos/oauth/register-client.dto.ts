import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Dynamic client registration (RFC 7591). Only the fields Studio reads are
// declared; the rest of the request is ignored.
export class RegisterClientDto {
  // https, http loopback or a private-use scheme (cursor://...),
  // validated in OAuthService.registerClient
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

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  client_uri?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  logo_uri?: string;

  // Every self-registered client is public (PKCE, no secret); the
  // registration response says so whatever is asked for here
  @IsString()
  @IsOptional()
  @MaxLength(100)
  token_endpoint_auth_method?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  grant_types?: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  response_types?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(500)
  scope?: string;
}
