// The compact layout (bottom menu, stacked editor): phones in either
// orientation and portrait tablets. The same query is the `compact:` screen in
// tailwind.config.cjs; keep the two in step.
export const COMPACT_QUERY = '(max-width: 1023px), (max-height: 500px)';

export const isCompact = () =>
  typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches;
