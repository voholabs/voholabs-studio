// Channels we currently support connecting. Everything else is shown as
// "Coming soon" and is not clickable until its OAuth app is configured.
// Its own file so pages outside the app (the public /pricing page) can read
// it without loading the Add Channel dialog.
export const ENABLED_PROVIDERS = [
  'youtube',
  'facebook',
  'instagram',
  'instagram-standalone',
  'linkedin',
  'linkedin-page',
  'x',
  'threads',
  'tiktok',
  'discord',
  'sanity',
];
