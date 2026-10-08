import { IsInt, Max, Min } from 'class-validator';

// How far into the onboarding tutorial the viewer got, in percent.
export class TutorialProgressDto {
  @IsInt()
  @Min(0)
  @Max(100)
  percent: number;
}
