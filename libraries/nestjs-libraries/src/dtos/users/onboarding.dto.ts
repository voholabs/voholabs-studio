import { IsOptional, IsString, MaxLength } from 'class-validator';

// Finishing onboarding. The steps themselves (a channel, an agent, the brief)
// are checked on the server, so the only thing sent is where the person came
// from.
export class OnboardingDto {
  // utm / referrer / landing page, as saved by the browser on the first visit.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attribution?: string;
}
