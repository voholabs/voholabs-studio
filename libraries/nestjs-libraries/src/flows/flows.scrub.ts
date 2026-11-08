import { SKILL_CHIP } from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

// A flow holds method and style, never brand facts: the gateway attaches the
// reader's own brand when it reads one. A flow imported from someone else's
// share link may still carry the author's brand, so it goes through this
// light scrub first. It is a heuristic, not a guarantee; the run-time brand
// kit rule is the real guard.

export const ACCENT_COLOUR = "the brand's accent colour";

// #RGB or #RRGGBB (and the 4/8 digit forms with alpha), not part of a word or
// a link fragment.
const HEX_COLOUR = /(^|[^\w&/#])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;

// A short code made only of letters is far more often a hashtag (#bad,
// #cafe) than a colour; #fff is the exception worth catching.
const isColour = (digits: string) =>
  digits.length > 4 || /\d/.test(digits) || /^f+$/i.test(digits);

const LINK = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

// A link to a file: an image, a video, a sound, a document or a font.
const MEDIA_FILE =
  /\.(png|jpe?g|gif|webp|avif|svg|heic|bmp|tiff?|mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|pdf|psd|ai|eps|ttf|otf|woff2?)(?:$|[?#])/i;

// Hosts that only ever serve stored files.
const STORAGE_HOSTS =
  /(^|\.)(r2\.dev|r2\.cloudflarestorage\.com|amazonaws\.com|cloudfront\.net|googleusercontent\.com|blob\.core\.windows\.net|digitaloceanspaces\.com|backblazeb2\.com|uploadcare\.com|cloudinary\.com|imgix\.net)$/i;

const OUR_NAME = /\bvoholabs(?:\.com)?(?:\s+studio)?\b/gi;

const isMediaLink = (link: string) => {
  try {
    const url = new URL(link);
    return (
      MEDIA_FILE.test(url.pathname) ||
      STORAGE_HOSTS.test(url.hostname) ||
      url.pathname.includes('/uploads/') ||
      url.pathname.includes('/mcp-files/')
    );
  } catch {
    return false;
  }
};

interface Found {
  colours: number;
  links: number;
  names: number;
}

const tidy = (text: string) =>
  text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\(\s*\)/g, '');

// One piece of a text with the scrubs applied, counted into found.
const scrubPiece = (text: string, found: Found) => {
  let out = text.replace(HEX_COLOUR, (match, before: string, digits: string) => {
    if (!isColour(digits)) {
      return match;
    }
    found.colours++;
    return `${before}${ACCENT_COLOUR}`;
  });
  out = out.replace(LINK, (link) => {
    if (!isMediaLink(link)) {
      return link;
    }
    found.links++;
    return '';
  });
  return out.replace(OUR_NAME, () => {
    found.names++;
    return '';
  });
};

// One text, scrubbed, with what was found in it. The target of a skill link
// ("](skill:<ref>)") is a reference and is never changed; its label and the
// text around it are scrubbed.
export const scrubText = (text: string) => {
  const found: Found = { colours: 0, links: 0, names: 0 };
  let out = '';
  let last = 0;
  for (const link of text.matchAll(SKILL_CHIP)) {
    const index = link.index || 0;
    out += scrubPiece(text.slice(last, index), found);
    const label = scrubPiece(link[1], found).trim().slice(0, 80) || link[2];
    out += `[Skill: ${label}](skill:${link[2]})`;
    last = index + link[0].length;
  }
  out += scrubPiece(text.slice(last), found);
  return {
    text: found.colours || found.links || found.names ? tidy(out) : text,
    found,
  };
};

export interface ScrubbableFlow {
  title?: string;
  whenToUse?: string;
  summary?: string;
  body?: string;
  // A custom flow's changes to its base.
  customization?: string;
  parts?: Record<string, string> | null;
}

const warningsFor = (found: Found, applied: boolean) => {
  const warnings: string[] = [];
  if (found.colours) {
    warnings.push(
      applied
        ? `Replaced ${found.colours} colour code(s) with "${ACCENT_COLOUR}".`
        : `The flow names ${found.colours} colour code(s); the brand kit of the workspace that runs it takes their place.`
    );
  }
  if (found.links) {
    warnings.push(
      applied
        ? `Removed ${found.links} link(s) to media files.`
        : `The flow links to ${found.links} media file(s); a shared copy has them removed.`
    );
  }
  if (found.names) {
    warnings.push(
      applied
        ? `Removed ${found.names} mention(s) of the Studio name.`
        : `The flow mentions the Studio name ${found.names} time(s); a shared copy has it removed.`
    );
  }
  return warnings;
};

// The text fields of a flow, scrubbed when apply is true, and the warnings
// that say what was (or, without apply, would be) changed. Never refuses.
export const scrubFlow = <T extends ScrubbableFlow>(
  flow: T,
  apply = true
): { flow: T; warnings: string[] } => {
  const total: Found = { colours: 0, links: 0, names: 0 };
  const one = (text?: string) => {
    if (typeof text !== 'string') {
      return text;
    }
    const { text: out, found } = scrubText(text);
    total.colours += found.colours;
    total.links += found.links;
    total.names += found.names;
    return out;
  };
  const scrubbed: T = {
    ...flow,
    title: one(flow.title),
    whenToUse: one(flow.whenToUse),
    summary: one(flow.summary),
    body: one(flow.body),
    customization: one(flow.customization),
    parts: flow.parts
      ? Object.fromEntries(
          Object.entries(flow.parts).map(([key, value]) => [key, one(value)])
        )
      : flow.parts,
  };
  return {
    flow: apply ? scrubbed : flow,
    warnings: warningsFor(total, apply),
  };
};
