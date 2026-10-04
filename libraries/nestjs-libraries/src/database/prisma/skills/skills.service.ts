import { Injectable } from '@nestjs/common';
import { SkillsRepository } from '@gitroom/nestjs-libraries/database/prisma/skills/skills.repository';

const clean = (value?: string, max = 200) => {
  const text = (value || '').trim().slice(0, max);
  return text || undefined;
};

// The skills library: ready-made instructions an agent reads through MCP.
// Everything comes from the Skill and SkillTag rows.
@Injectable()
export class SkillsService {
  constructor(private _skills: SkillsRepository) {}

  async list(filter: { tag?: string; search?: string } = {}) {
    const tag = clean(filter.tag, 64);
    const search = clean(filter.search);

    const [allTags, used] = await Promise.all([
      this._skills.tags(),
      this._skills.activeTagKeys(),
    ]);
    // Only tags that at least one active skill carries.
    const tags = allTags.filter((one) => used.has(one.key));

    // A search also matches the tag labels ("tips" finds "Tips and tricks").
    const searchTags = search
      ? tags
          .filter((one) =>
            one.label.toLowerCase().includes(search.toLowerCase())
          )
          .map((one) => one.key)
      : [];

    const skills = await this._skills.list({ tag, search, searchTags });
    return { tags, skills };
  }

  get(slug: string) {
    const key = clean(slug, 128);
    if (!key) {
      return Promise.resolve(null);
    }
    return this._skills.get(key);
  }
}
