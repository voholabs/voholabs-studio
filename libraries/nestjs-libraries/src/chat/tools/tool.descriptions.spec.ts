// Tool descriptions and input descriptions describe: what the tool does, its
// inputs, its effects and what it returns. ChatGPT reviews them before a tool
// call and flags wording that reads as orders to the AI ("Suspicious
// Instruction"). This spec reads every tool source file in this folder and
// fails on instruction-like wording in a `description:` or `.describe()` text.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const BANNED =
  /\b(always|must|never|do not|don['’]t|should|make sure|be sure|first call|instead of using|whenever|required to|you may|before calling|ignore|important)\b|\buse\b[^.\n]*\binstead\b/gi;

// One literal: a template, single- or double-quoted string.
const LITERAL = String.raw`(\x60(?:\\[\s\S]|[^\\\x60])*\x60|'(?:\\[\s\S]|[^\\'])*'|"(?:\\[\s\S]|[^\\"])*")`;
// A description is a literal, or literals joined with "+".
const TEXT = new RegExp(
  String.raw`(?:\bdescription\s*:|\.describe\s*\()\s*(${LITERAL}(?:\s*\+\s*${LITERAL})*)`,
  'g'
);

const descriptionsOf = (source: string): string[] =>
  [...source.matchAll(TEXT)].map((match) => match[1]);

describe('tool descriptions', () => {
  const folder = __dirname;
  const files = readdirSync(folder).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts')
  );

  it('finds descriptions to check', () => {
    const total = files.reduce(
      (sum, name) =>
        sum + descriptionsOf(readFileSync(join(folder, name), 'utf8')).length,
      0
    );
    expect(total).toBeGreaterThan(100);
  });

  it('describe the tool and never instruct the model', () => {
    const offences: string[] = [];
    for (const name of files) {
      const source = readFileSync(join(folder, name), 'utf8');
      for (const text of descriptionsOf(source)) {
        for (const hit of text.matchAll(BANNED)) {
          const start = Math.max(0, (hit.index || 0) - 40);
          const excerpt = text
            .slice(start, (hit.index || 0) + hit[0].length + 40)
            .replace(/\s+/g, ' ');
          offences.push(`${name}: "${hit[0]}" in …${excerpt}…`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});
