# plex-director-mcp

[![CI/CD](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/ci.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/honeybeartech/plex-director-mcp?logo=docker&logoColor=white)](https://hub.docker.com/r/honeybeartech/plex-director-mcp)
[![Docker Version](https://img.shields.io/docker/v/honeybeartech/plex-director-mcp?sort=semver&logo=docker&logoColor=white&label=version)](https://hub.docker.com/r/honeybeartech/plex-director-mcp/tags)
[![Image Size](https://img.shields.io/docker/image-size/honeybeartech/plex-director-mcp/latest?logo=docker&logoColor=white)](https://hub.docker.com/r/honeybeartech/plex-director-mcp)
[![Node](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](package.json)

A Claude Desktop MCP server for troubleshooting and managing a self-hosted Plex + Servarr media stack, plus the supporting download and infrastructure layers around it.

> The CI/CD badge is served by GitHub itself, so it renders for anyone with repo access even though this repo is private. The Docker badges read from the public Docker Hub mirror (`hub.docker.com/r/honeybeartech/plex-director-mcp`) since GHCR doesn't expose pull counts or a queryable version, and third-party badge services can't read a private repo's GHCR package.

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
- `resolve_actor_filmography`
- `check_indexer_health`
- `search_and_select_movies`
- `confirm_selected_choices`
- `run_cluster_backup`
- `manage_stalled_downloads`
- `get_cluster_infrastructure_health`
- `get_cluster_hardware_analytics`

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
```

Notes:

- `SONARR_*`, `QBITTORRENT_*`, and SSH/cluster variables are optional and only needed for the extra tooling you want enabled.
- `DISCORD_WEBHOOK_URL` is optional and used for rich job notifications when configured.
- `UBUNTU_HOSTS` should be a comma-separated list of remote hosts to monitor.

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

The server runs via stdio and waits for MCP client connections.

## Running in Docker

Every push to `main` that passes CI publishes an image to GitHub Container Registry (private, tied to this repo) and to Docker Hub (public):

```bash
docker run -i --rm --env-file .env ghcr.io/honeybeartech/plex-director-mcp:latest
# or
docker run -i --rm --env-file .env honeybeartech/plex-director-mcp:latest
```

The `-i` flag is required since the server communicates over stdio, not a network port. You can also build it locally:

```bash
docker build -t plex-director-mcp .
```

`.dockerignore` keeps `.env`, `data/` (the local SQLite database), and other secrets/local state out of the build context, mirroring `.gitignore`. Pass configuration at run time with `--env-file` or `-e`, as above — never bake secrets into the image.

## CI/CD

`.github/workflows/ci.yml` has three jobs:

- **Typecheck & audit** (`check`) — runs on every push and pull request against `main`: `tsc --noEmit` and `npm audit --audit-level=high`.
- **Build & push Docker image** (`publish`) — runs on every push to `main` and every `v*.*.*` tag push, only if `check` passes. Publishes to both `ghcr.io/honeybeartech/plex-director-mcp` and `honeybeartech/plex-director-mcp` on Docker Hub. Branch pushes tag the image `latest` plus the commit SHA; tag pushes additionally tag it with the matching semver version (e.g. `1.2.3` and `1.2`).
- **Create GitHub Release** (`release`) — runs only on `v*.*.*` tag pushes, after `publish` succeeds. Creates a GitHub Release from the tag with auto-generated notes.

To cut a release, optionally bump `"version"` in `package.json` to match, then:

```bash
git tag v1.2.3
git push origin v1.2.3
```

Publishing to GHCR uses the repo's built-in `GITHUB_TOKEN` — no extra setup needed there, but the repo's Actions settings must have "Read and write permissions" enabled for workflows (Settings → Actions → General → Workflow permissions). Publishing to Docker Hub needs two repository secrets set manually (Settings → Secrets and variables → Actions): `DOCKERHUB_USERNAME` and a `DOCKERHUB_TOKEN` (a Docker Hub access token with Read & Write scope).

## Runtime notes

- Uses the official MCP SDK
- Stores persistent job state and selection context in a local SQLite database: `data/plex_director.db`
- Loads configuration from `.env`
- Supports optional Discord webhook alerts and remote SSH host monitoring
- Intended for local self-hosted media automation, queue troubleshooting, and host-level observability

## Why this exists

If your Plex library is missing content, your downloads are failing, your indexers are unhealthy, your torrent queue is stalled, or you want Claude to inspect the broader media stack and infrastructure around it, this MCP gives it the runtime context it needs to assess the issue and act on the most likely causes.

This project is designed specifically for a home-run Servarr ecosystem, with the goal of making both media operations and host-level troubleshooting easier to diagnose and execute from within Claude Desktop.
