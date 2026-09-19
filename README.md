# plex-director-mcp

[![CI/CD](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/HoneyBearTech/plex-director-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/HoneyBearTech/plex-director-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/honeybeartech/plex-director-mcp?logoColor=white&logo=docker)](https://hub.docker.com/r/honeybeartech/plex-director-mcp)
[![Docker Version](https://img.shields.io/github/v/tag/HoneyBearTech/plex-director-mcp?sort=semver&logo=docker&logoColor=white&label=version)](https://hub.docker.com/r/honeybeartech/plex-director-mcp/tags)
[![Image Size](https://img.shields.io/docker/image-size/honeybeartech/plex-director-mcp/latest?logo=docker&logoColor=white)](https://hub.docker.com/r/honeybeartech/plex-director-mcp)
[![Node](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](package.json)
[![License](https://img.shields.io/github/license/HoneyBearTech/plex-director-mcp)](LICENSE)

A Claude Desktop MCP server for troubleshooting and managing a self-hosted Plex + Servarr media stack, plus the supporting download and infrastructure layers around it — with a companion browser dashboard for the same lookups outside of a chat session.

This project gives Claude access to your Radarr, Sonarr, SABnzbd, qBittorrent, Tautulli, TMDb, Prowlarr, and remote Ubuntu host monitoring setup so it can diagnose missing media, watch queue health, evaluate cluster status, and coordinate safe operational tasks from inside Claude Desktop.

## What it does

`plex-director-mcp` exposes MCP tools for:

- checking movie status in Radarr
- diagnosing why a movie is missing from the library
- checking active Plex streams and recent library usage through Tautulli
- tracking background media jobs in SQLite
- planning and step-executing safe media upgrade/search jobs
- resolving actor filmographies from TMDb
- checking Prowlarr indexer health and failures
- searching TMDb results when a title is ambiguous and confirming the user-selected choices
- managing qBittorrent stalled or low-speed downloads
- triggering cluster backup operations and verifying local backup directories
- monitoring remote Ubuntu hosts over SSH for CPU, memory, and Docker health
- sending optional Discord status notifications for completed batch jobs

This is not a generic Plex wrapper. It is specifically an operations assistant for a home media stack and the systems that keep it healthy.

## Tools included

- `check_movie_status`
- `diagnose_missing_media`
- `get_plex_activity`
- `get_library_analytics`
- `get_background_jobs`
- `update_job_status`
- `plan_media_upgrade`
- `execute_next_job_step`
- `search_plex_library`
- `resolve_actor_filmography`
- `check_indexer_health`
- `search_and_select_movies`
- `confirm_selected_choices`
- `run_cluster_backup`
- `manage_stalled_downloads`
- `get_cluster_infrastructure_health`
- `get_cluster_hardware_analytics`

### Plex search

`search_plex_library` searches the movies actually in your Plex library — across every movie library, including 4K — by any combination of genre, actor, title, and year. `resolve_actor_filmography` lists an actor's TMDb filmography and, when Plex is configured, marks which of those movies you own and which you don't (optionally narrowed by year range or owned/missing). Both need `PLEX_URL` and `PLEX_TOKEN` (see below); ownership is matched by TMDb id, so it relies on Plex's TMDb metadata. In the web UI's Query page, the results appear as a table with posters.

To find your Plex token: open any movie in Plex Web, choose **⋯ → Get Info → View XML**, and copy the `X-Plex-Token=` value from the URL. Treat it like a password.

## Claude Desktop setup

This repo is intended to be used as a local MCP server from Claude Desktop.

### 1) Install dependencies

```bash
npm install
```

### 2) Create a `.env` file

Create a `.env` file in the repo root with your service URLs and API keys:

```env
RADARR_URL=http://radarr:7878
RADARR_API_KEY=your_radarr_api_key
SONARR_URL=http://sonarr:8989
SONARR_API_KEY=your_sonarr_api_key
SABNZBD_URL=http://sabnzbd:8080
SABNZBD_API_KEY=your_sabnzbd_api_key
TAUTULLI_URL=http://tautulli:8181
TAUTULLI_API_KEY=your_tautulli_api_key
PLEX_URL=http://plex:32400
PLEX_TOKEN=your_plex_token
TMDB_API_KEY=your_tmdb_api_key
PROWLARR_URL=http://prowlarr:9696
PROWLARR_API_KEY=your_prowlarr_api_key
QBITTORRENT_URL=http://qbittorrent:8080
QBITTORRENT_USER=your_qbittorrent_user
QBITTORRENT_PASS=your_qbittorrent_password
UBUNTU_HOSTS=192.168.1.10,192.168.1.11
SSH_USER=your_ssh_username
SSH_KEY_PATH=/path/to/id_ed25519
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
BACKUP_DIR=./backups
WEB_PORT=3000
WEB_PASSWORD=choose_a_dashboard_password
```

Notes:

- `SONARR_*`, `QBITTORRENT_*`, and SSH/cluster variables are optional and only needed for the extra tooling you want enabled.
- `DISCORD_WEBHOOK_URL` is optional and used for rich job notifications when configured.
- `UBUNTU_HOSTS` should be a comma-separated list of remote hosts to monitor.
- `WEB_PORT` is optional (defaults to `3000`) and controls the web UI's port.
- `WEB_PASSWORD` is optional but **strongly recommended**: when set, the web dashboard requires this password (a login page, then a signed 7-day session cookie). Leave it unset and the dashboard is open to anyone who can reach the port, and the server logs a warning at startup. It is read only from the environment, never from the Settings page. Changing it signs everyone out.
- **Don't put inline comments on the same line as a value** (e.g. `TMDB_API_KEY=abc123 # my key`). Docker's `--env-file` flag doesn't strip these the way `dotenv` does - the comment becomes part of the value, silently breaking that credential when run via `docker run --env-file .env`. Put comments on their own line above the variable instead.

### 3) Add the server to Claude Desktop

Open Claude Desktop Settings and add an MCP server config similar to this:

```json
{
  "mcpServers": {
    "plex-director": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/absolute/path/to/plex-director-mcp/src/index.ts"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

Replace `/absolute/path/to/plex-director-mcp` with the real path to this repo on your machine.

### 4) Restart Claude Desktop

After saving the config, restart Claude Desktop and the `plex-director` server should appear as an MCP tool provider.

## Local development

Run the server directly:

```bash
npm run start
```

The server runs via stdio and waits for MCP client connections; it also starts an HTTP server for the web UI (see below) on the same process.

## Web UI

Alongside the MCP stdio interface, the server hosts a small read-only browser dashboard on `WEB_PORT` (default `3000`, override via `.env`): movie search/status/diagnosis, Plex activity and library analytics, per-host CPU/RAM/Docker utilization (over SSH), and the SABnzbd/qBittorrent queues. It's intentionally read-only apart from the Settings page. **Set `WEB_PASSWORD` to require a login** — without it the dashboard has no authentication, so anyone who can reach the port can use it (including changing settings), and it shouldn't be exposed beyond a trusted network. The login is a single shared password (failed attempts are rate-limited); if you serve the dashboard over HTTPS the session cookie is marked `Secure` automatically.

It's a separate npm project under `web/` (React + Vite + TypeScript, its own `package.json`) so its toolchain doesn't need to match the root project's. To work on it:

```bash
cd web
npm install
npm run dev   # dev server on :5173, proxies /api to the backend on :3000
```

`npm run build` in `web/` produces the static assets the backend serves in production; the Dockerfile builds this automatically.

## Running in Docker

Every push to `main` that passes CI publishes an image to both GitHub Container Registry and Docker Hub:

```bash
docker run -i --rm -p 3000:3000 --env-file .env ghcr.io/honeybeartech/plex-director-mcp:latest
# or
docker run -i --rm -p 3000:3000 --env-file .env honeybeartech/plex-director-mcp:latest
```

The `-i` flag is required since the MCP interface communicates over stdio; `-p 3000:3000` exposes the web UI. You can also build it locally:

```bash
docker build -t plex-director-mcp .
```

`.dockerignore` keeps `.env`, `data/` (the local SQLite database), and other secrets/local state out of the build context, mirroring `.gitignore`. Pass configuration at run time with `--env-file` or `-e`, as above — never bake secrets into the image.

## CI/CD

`.github/workflows/ci.yml` has three jobs:

- **Typecheck & audit** (`check`) — runs on every push and pull request against `main`: `tsc --noEmit` and `npm audit --audit-level=high`.
- **Build, smoke test, and publish** (`publish`) — runs on every push to `main`, every `v*.*.*` tag push, and every pull request, as long as `check` passes. Every run builds the image and boots it with dummy config to confirm it actually starts (catches things like the two Dockerfile stages drifting to incompatible Node versions — Dependabot can't know they need to move together, since it tracks each `FROM` line independently). Only push events go further: publishing to both `ghcr.io/honeybeartech/plex-director-mcp` and `honeybeartech/plex-director-mcp` on Docker Hub (branch pushes tag `latest` plus the commit SHA; tag pushes additionally get the matching semver version, e.g. `1.2.3` and `1.2`), then a [Docker Scout](https://docs.docker.com/scout/) CVE scan written to the job summary (non-blocking for now — `exit-code: false` — until there's a reviewed baseline), and finally a keyless [cosign](https://docs.sigstore.dev/cosign/) signature (via GitHub's OIDC token, no key management) on both published images — verify with `cosign verify --certificate-identity-regexp "https://github.com/HoneyBearTech/plex-director-mcp/.*" --certificate-oidc-issuer https://token.actions.githubusercontent.com <image>@<digest>`.
- **Create GitHub Release** (`release`) — runs only on `v*.*.*` tag pushes, after `publish` succeeds. Creates a GitHub Release from the tag with auto-generated notes.

`.github/workflows/codeql.yml` runs [CodeQL](https://codeql.github.com/) against the TypeScript source on every push/PR to `main` and weekly, surfacing findings in the repo's Security tab.

`.github/workflows/scorecard.yml` runs [OpenSSF Scorecard](https://scorecard.dev/) weekly (and on push to `main`), scoring the repo's supply-chain security practices — branch protection, pinned dependencies, CI practices, and so on — and publishing the result publicly (see the badge above).

`.github/dependabot.yml` opens weekly PRs for npm, Docker base image, and GitHub Actions updates (grouped by minor/patch to cut down on PR noise; the Docker `node` dependency's major bumps are ignored, since the builder and distroless runtime stages' versions have to be coordinated by hand). `.github/workflows/dependabot-auto-merge.yml` auto-merges those PRs once `check` and `publish` pass, as long as the update isn't a major version bump — those are left for manual review.

## Runtime notes

- Uses the official MCP SDK
- Stores persistent job state and selection context in a local SQLite database: `data/plex_director.db`
- Loads configuration from `.env`
- Supports optional Discord webhook alerts and remote SSH host monitoring
- Intended for local self-hosted media automation, queue troubleshooting, and host-level observability

## Why this exists

If your Plex library is missing content, your downloads are failing, your indexers are unhealthy, your torrent queue is stalled, or you want Claude to inspect the broader media stack and infrastructure around it, this MCP gives it the runtime context it needs to assess the issue and act on the most likely causes.

This project is designed specifically for a home-run Servarr ecosystem, with the goal of making both media operations and host-level troubleshooting easier to diagnose and execute from within Claude Desktop.
