// @ts-ignore twitter-text has no types
import twitter from 'twitter-text';

// The action an X post is charged as. X bills a post with any URL in it
// (bare domains included) at the link rate, so this uses X's own URL rules on
// the exact text sent to X, after any link stripping.
export const xPostActionKey = (text: string) =>
  (twitter.extractUrls(text || '') as string[]).length
    ? 'x.post_link'
    : 'x.post';
