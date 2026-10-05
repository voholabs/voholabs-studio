# Voholabs Studio

A free social media scheduler with no cap on channels or posts.

Voholabs Studio schedules posts to LinkedIn profiles and pages, X, Instagram, Facebook, Threads, TikTok and YouTube from one calendar. The hosted version is at [voholabs.com/studio](https://voholabs.com/studio).

## What is free

- Unlimited channels
- Unlimited scheduled posts
- Calendar, team members and webhooks
- A public API
- An MCP connection, so an AI assistant can schedule for you

## What is not

- X is pay as you go, because X bills every tool for each post it sends. You pay only when you post there.
- Media storage is capped at 2 GB on the free plan.
- AI writing, image and video generation and the agent brief are paid.
- The hosted version is community hosted. Support is limited and fixes land at our own pace. Issues and pull requests are welcome.

## Connect an AI assistant (MCP)

The MCP server runs at `https://studio.voholabs.com/api/mcp` and authenticates with your key. Through it an assistant can:

- see which account and channels it is working with
- read each network's rules before it writes
- schedule, draft, edit, reschedule and delete posts
- find the next free slot for a channel
- upload images and videos
- read channel and post analytics

Setup for Claude, ChatGPT and coding agents: [voholabs.com/docs/agents](https://voholabs.com/docs/agents).

## Command line

The CLI lives in `apps/cli`. From the repository root:

```sh
./apps/cli/install.sh
voholabs auth:login
voholabs integrations:list
```

See `apps/cli/README.md` for the commands.

## Licence

Voholabs Studio is open source under the [GNU Affero General Public License v3.0](LICENSE). The licence text and the copyright notices of all original authors are kept in this repository and must stay with any copy or modified version.
