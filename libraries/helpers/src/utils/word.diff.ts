export type WordDiffPart = {
  type: 'same' | 'added' | 'removed';
  text: string;
};

// Above this many DP cells the table stops being worth building — a post that
// long is not something a reviewer word-edited anyway, so fall back to showing
// the two versions whole.
const MAX_CELLS = 4_000_000;

const tokenize = (value: string) => (value || '').split(/\s+/).filter(Boolean);

const merge = (parts: WordDiffPart[]): WordDiffPart[] =>
  parts.reduce((all, part) => {
    const last = all[all.length - 1];
    if (last && last.type === part.type) {
      last.text = `${last.text} ${part.text}`;
      return all;
    }

    all.push({ ...part });
    return all;
  }, [] as WordDiffPart[]);

/**
 * Word-level diff between two plain-text strings, as a longest-common-
 * subsequence walk. Written by hand because the repository has no diff
 * dependency and this is the only place that needs one.
 */
export const wordDiff = (before: string, after: string): WordDiffPart[] => {
  const a = tokenize(before);
  const b = tokenize(after);

  if (!a.length && !b.length) {
    return [];
  }

  if (!a.length) {
    return [{ type: 'added', text: b.join(' ') }];
  }

  if (!b.length) {
    return [{ type: 'removed', text: a.join(' ') }];
  }

  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return [
      { type: 'removed', text: a.join(' ') },
      { type: 'added', text: b.join(' ') },
    ];
  }

  const width = b.length + 1;
  // dp[i][j] = length of the LCS of a[i..] and b[j..]
  const dp = new Uint32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const parts: WordDiffPart[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      parts.push({ type: 'same', text: a[i] });
      i++;
      j++;
      continue;
    }

    if (
      j < b.length &&
      (i === a.length || dp[i * width + j + 1] >= dp[(i + 1) * width + j])
    ) {
      parts.push({ type: 'added', text: b[j] });
      j++;
      continue;
    }

    parts.push({ type: 'removed', text: a[i] });
    i++;
  }

  return merge(parts);
};

/**
 * One-line rendering of a diff for a reader that only sees text: removals in
 * [-brackets-], additions in {+braces+}. Compact enough to hand a model a whole
 * thread's worth of changes at once.
 */
export const renderWordDiff = (parts: WordDiffPart[]): string =>
  parts
    .map((part) => {
      if (part.type === 'added') {
        return `{+${part.text}+}`;
      }

      if (part.type === 'removed') {
        return `[-${part.text}-]`;
      }

      return part.text;
    })
    .join(' ');
