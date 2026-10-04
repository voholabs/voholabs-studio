import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkillsService } from '@gitroom/nestjs-libraries/database/prisma/skills/skills.service';

// The skills library. Built in stream S4.
@ApiTags('Skills')
@Controller('/skills')
export class SkillsController {
  constructor(private _skills: SkillsService) {}
}
