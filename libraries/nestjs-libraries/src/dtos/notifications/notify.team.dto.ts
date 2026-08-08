import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class NotifyTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  message: string;

  // A filter over the team, not a list of addresses to deliver to. The service
  // intersects it with the organization's members, so validating the shape here
  // is about rejecting nonsense early, not about safety — an address that
  // passes validation still cannot receive anything unless it is a member.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsEmail({}, { each: true })
  to?: string[];
}
