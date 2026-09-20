import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// The options live here so the form and the validation cannot drift apart.
export const onboardingRoles = [
  'Founder / Owner',
  'Marketing',
  'Social media manager',
  'Content creator',
  'Agency',
  'Developer',
  'Other',
] as const;

export const onboardingHeardFrom = [
  'Google search',
  'X / Twitter',
  'LinkedIn',
  'YouTube',
  'Instagram / TikTok',
  'Friend or colleague',
  'AI assistant (ChatGPT, Claude...)',
  'Blog or newsletter',
  'Other',
] as const;

export const onboardingUseCases = [
  'Schedule posts for my own brand',
  'Manage social media for my company',
  'Manage clients as an agency',
  'Let an AI agent post for me',
  'Post to many channels at once',
  'Just exploring',
] as const;

export class OnboardingDto {
  @IsString()
  @IsDefined()
  @MinLength(2)
  @MaxLength(128)
  name: string;

  // A domain, with or without the protocol: "acme.com", "https://acme.com/us".
  @IsString()
  @IsDefined()
  @MaxLength(200)
  @Matches(/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i, {
    message: 'Please enter a valid website, like acme.com',
  })
  website: string;

  @IsDefined()
  @IsIn(onboardingRoles)
  role: string;

  @IsDefined()
  @IsIn(onboardingHeardFrom)
  heardFrom: string;

  @IsDefined()
  @IsIn(onboardingUseCases)
  useCase: string;

  // utm / referrer / landing page, as saved by the browser on the first visit.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attribution?: string;
}
