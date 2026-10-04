import { Injectable } from '@nestjs/common';
import { SkillsRepository } from '@gitroom/nestjs-libraries/database/prisma/skills/skills.repository';

// The skills library. Built in stream S4.
@Injectable()
export class SkillsService {
  constructor(private _skills: SkillsRepository) {}
}
