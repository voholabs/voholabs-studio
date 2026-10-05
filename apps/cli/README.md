# Voholabs Studio CLI

Docs: https://voholabs.com/docs/cli (API reference: https://voholabs.com/docs/api,
OpenAPI description: `https://studio.voholabs.com/api/public/v1/openapi.json`).

Schedules posts, threads and carousels against a self-hosted Voholabs Studio
(`https://studio.voholabs.com/api`). Used by the content agents to draft and
schedule LinkedIn, X, Threads and Facebook posts without opening the UI.

## Install

```sh
./apps/cli/install.sh
voholabs auth:login
```

Requires **Node 22.12 or newer** and network access to `studio.voholabs.com`. The
version floor is real rather than cautious: the bundle is CommonJS but depends on
`node-fetch` v3, which is ESM, so it only loads where `require(esm)` is enabled.
The installer refuses to install against anything older, because the failure
otherwise surfaces much later as a broken response body rather than a load error.

That puts the package in `~/.voholabs-cli` and a launcher on `~/.local/bin/voholabs`.
Both are permanent locations. **Never install this from `/tmp`**: macOS prunes
`/tmp` after roughly three days, which silently deletes the CLI and its
`node_modules` mid-workflow.

If `~/.local/bin` is not on your `PATH`, add it to `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

### Why a shell launcher instead of `npm link`

The CLI bundle starts with `#!/usr/bin/env node`, so an npm-style install is only
as reliable as whatever `node` your shell happens to resolve first. On a machine
with a broken Homebrew node, or with nvm loaded but no `default` alias, that
resolves to something that cannot run and the CLI dies with a dyld or
module-not-found error that looks like a CLI bug.

`voholabs.sh` picks a Node that actually executes (newest nvm version first, then
`node` on `PATH`, then the usual Homebrew and `/usr/local` paths) and execs the
bundle with it. Override with `VOHOLABS_NODE=/path/to/node`.

## Authentication

Either OAuth (device flow, stored in `~/.voholabs/credentials.json`):

```sh
voholabs auth:login
voholabs auth:status
```

or an API key:

```sh
export VOHOLABS_API_KEY=...
```

## Common commands

```sh
voholabs integrations:list                 # channel ids, resolve these live, never hardcode
voholabs upload <file>                     # returns a hosted { path } URL, reuse it across platforms
voholabs posts:create ...                  # see below
voholabs posts:list                        # state: DRAFT | QUEUE | PUBLISHED, plus releaseURL once live
voholabs posts:delete <id>                 # only meaningful before publish
voholabs wallet:balance                    # wallet credits, auto top-up, scheduled usage forecast
voholabs wallet:prices [--provider x]      # what costs credits; channels not listed are free
voholabs wallet:estimate --provider x -c "<post>" -c "<reply>"   # price a post, nothing is charged
voholabs skills:list / skills:get <slug>   # the skills library
voholabs brief:onboarding                  # guided brief onboarding status and its start link
```

On a pay-as-you-go workspace a post on a channel charged per post (X) is paid
from the wallet when it is scheduled, not when it publishes; drafts are free.
When the credits do not cover it, `posts:create` fails with the reason and the
top-up link. TikTok is available on every plan.

### Creating posts

```sh
# Single post with a carousel (LinkedIn, Facebook)
voholabs posts:create -t draft -s "<ISO8601>" -i "<integrationId>" \
  -c "<caption>" -m "url1,url2,url3"

# Thread, one image per post (X, Threads): repeat -c, each with its own -m
voholabs posts:create -t draft -s "<ISO8601>" -i "<integrationId>" \
  -c "<post 1>" -m "url1" \
  -c "<post 2>" -m "url2" \
  -c "<final post>"

# First comment: a trailing -c with -d <minutes> after the post
voholabs posts:create ... -c "<caption>" -m "..." -c "<first comment>" -d 17

# X requires reply settings
voholabs posts:create ... --settings '{"who_can_reply_post":"everyone"}'
```

Notes that bite:

- `-s` is required even for `-t draft`.
- There is no `posts:update`. To change a post, `posts:delete` then recreate,
  and only while it is still `DRAFT` or `QUEUE`. Deleting a `PUBLISHED` post does
  not remove it from the platform, recreating just produces a duplicate.
- Delayed first comments (`-d`) are unreliable. Verify on the live post and paste
  manually if the comment did not land.
- Media caps: X 4 images per post, Threads 10 per post.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `command not found: voholabs` | `~/.local/bin` not on `PATH` | add the export above to `~/.zshrc` |
| `Library not loaded: ...libicui18n...dylib` | broken Homebrew node picked up by `env node` | already handled by the launcher; to fix node itself, `brew reinstall node` |
| `Cannot find module 'yargs'` | package installed somewhere transient, or deps missing | rerun `install.sh` |
| `Premature close` / `ERR_STREAM_PREMATURE_CLOSE` on any command | `node-fetch` v2 installed instead of v3, or Node older than 22.12 | rerun `install.sh`, it pins v3 and gates the Node version |
| `No authentication found` | credentials missing or wiped | `voholabs auth:login` |

## Provenance

A rebranded build of the upstream Postiz CLI, pointed at the self-hosted Studio
API by default and storing credentials in `~/.voholabs` rather than `~/.postiz`.
`index.js` is the built bundle, vendored here so the CLI survives a wiped
machine and installs the same way for everyone.
