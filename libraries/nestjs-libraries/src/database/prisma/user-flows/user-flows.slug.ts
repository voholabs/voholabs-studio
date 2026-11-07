import { USER_FLOW_SLUG_MAX } from '@gitroom/nestjs-libraries/dtos/flows/user-flow.dto';

// The slugs of My flows and My skills ("my/<slug>"). Shared by both services,
// so it lives apart from them (the flows service depends on the skills one).

// "Carousel for launches!" -> "carousel-for-launches"
export const slugify = (title: string, fallback = 'flow') => {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || fallback;
};

// The slug itself when it is not taken, otherwise the first free
// "<slug>-2", "-3"...
export const nextFreeSlug = (slug: string, taken: Set<string>) => {
  if (!taken.has(slug)) {
    return slug;
  }
  const stem = slug.slice(0, USER_FLOW_SLUG_MAX - 4);
  for (let n = 2; ; n++) {
    const next = `${stem}-${n}`;
    if (!taken.has(next)) {
      return next;
    }
  }
};
