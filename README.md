# plex-director-mcp

[![CI/CD](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/HoneyBearTech/plex-director-mcp/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/HoneyBearTech/plex-director-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/HoneyBearTech/plex-director-mcp)
[![Docker Pulls](https://img.shields.io/docker/pulls/honeybeartech/plex-director-mcp?logoColor=white&logo=docker)](https://hub.docker.com/r/honeybeartech/plex-director-mcp)
[![Docker Version](https://img.shields.io/github/v/tag/HoneyBearTech/plex-director-mcp?sort=semver&logo=docker&logoColor=white&label=version)](https://hub.docker.com/r/honeybeartech/plex-director-mcp/tags)
[![Image Size](https://img.shields.io/docker/image-size/honeybeartech/plex-director-mcp/latest?logo=docker&logoColor=white)](https://hub.docker.com/r/honeybeartech/plex-director-mcp)
[![Node](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](package.json)
[![License](https://img.shields.io/github/license/HoneyBearTech/plex-director-mcp)](LICENSE)

**Plex Director** is a self-hosted assistant for a Plex + Servarr media stack. It connects to Plex, Radarr, Sonarr, Prowlarr, SABnzbd, qBittorrent, Tautulli and TMDb (and, optionally, your Linux hosts over SSH), and gives you two ways to work with them:

- **An MCP server for Claude Desktop** — ask Claude to find what you own, work out why a movie is missing, add movies, check your indexers and download queues, or run batch jobs.
- **A web dashboard** — a browser UI with a chat box ("Which of Harrison Ford's movies do I have in 4K?"), server status, host utilization, download queues, indexer health, and background jobs.

It is built for a home-run setup: run it on your LAN, next to the apps it talks to.

## Contents

- [What it can do](#what-it-can-do)
- [Quick start](#quick-start)
- [Docker](#docker)
  - [Supported architectures](#supported-architectures)
  - [Image tags](#image-tags)
  - [Application setup](#application-setup)
  - [Usage](#usage) — [Docker Compose](#docker-compose-recommended) · [Docker CLI](#docker-cli) · [Claude Desktop via Docker](#claude-desktop-via-docker)
  - [Parameters](#parameters)
  - [Environment variable reference](#environment-variable-reference)
  - [Read-only and non-root operation](#read-only-and-non-root-operation)
  - [Updating](#updating)
  - [Building locally](#building-locally)
- [Run without Docker (Claude Desktop)](#run-without-docker-claude-desktop)
- [Web dashboard](#web-dashboard)
- [MCP tools](#mcp-tools)
- [Security](#security)
- [Development](#development)
- [CI/CD](#cicd)
- [License](#license)

## What it can do

- **Find what you own.** Search your Plex library, movies and TV shows, by genre, actor, title, year and library (for example just the 4K libraries) across every library at once. A title held in both HD and 4K is one result with both libraries shown, and shows come with their season and episode counts and how much you have watched. You can leave a library such as Sports out of searches unless you name it.
- **Owned versus missing.** Look up an actor's TMDb filmography and see which of those movies are in Plex and which are not, optionally narrowed by year range, or by "in 4K".
- **Diagnose and add movies.** Trace a movie through Radarr metadata, history and the download queues to see why it is missing, or search TMDb, pick from a grid, and add the choices to Radarr with a download search.
- **Watch your downloads and indexers.** See SABnzbd and qBittorrent queues, clean up stalled torrents, and check every Prowlarr indexer's health (including ones that are backing off).
- **Run batch jobs safely.** Plan a movie-upgrade batch and let a rate-limited runner search one movie a minute, with pause, resume, cancel, and automatic pausing if Radarr stops responding.
- **Keep an eye on your hosts.** CPU, memory, disk, uptime and Docker container health for your Linux hosts over SSH, plus Radarr, Sonarr and Prowlarr built-in backups on demand. Each host's SSH key is remembered the first time it connects, and a changed key is refused until you approve it.
- **Understand usage.** Live Plex streams and watch statistics through Tautulli.
- **Stay informed.** Optional Discord notifications when a batch job finishes or is paused.

## Quick start

The fastest way to try it is Docker Compose:

```yaml
---
services:
  plex-director:
    image: honeybeartech/plex-director-mcp:latest
    container_name: plex-director
    environment:
      - WEB_PASSWORD=choose-a-password
    volumes:
      - ./data:/app/data
    ports:
      - 3000:3000
    restart: unless-stopped
```

```bash
docker compose up -d
```

Then open **http://localhost:3000**, sign in, and fill in your services on the **Settings** page (Radarr, Sonarr, Prowlarr, SABnzbd, qBittorrent, Tautulli, Plex, TMDb). The full guide, with every option, is in [Docker](#docker) below. To use it from Claude Desktop instead, see [Claude Desktop via Docker](#claude-desktop-via-docker).

## Docker

Images are published to both registries, and both are signed (see [CI/CD](#cicd)):

| Registry | Image |
| :--- | :--- |
| Docker Hub | `honeybeartech/plex-director-mcp` |
| GitHub Container Registry | `ghcr.io/honeybeartech/plex-director-mcp` |

Everything below works with either; the examples use Docker Hub.

### Supported architectures

Multi-arch manifests are published, so pulling the image gets the right one for your machine automatically.

| Architecture | Available |
| :---: | :---: |
| x86-64 (`linux/amd64`) | ✅ |
| arm64 (`linux/arm64`) | ✅ |

### Image tags

| Tag | Description |
| :---: | :--- |
| `latest` | The most recent build of the `main` branch. Includes changes that have not been given a version number yet. |
| `1.1.0` | A specific release. Pin one of these if you want to choose when to upgrade. |
| `1.1` | The newest patch release of a minor version. |
| `sha-<commit>` | The build of one specific commit, for pinning or bisecting. |

Release notes for the numbered versions are on the [Releases](https://github.com/HoneyBearTech/plex-director-mcp/releases) page.

### Application setup

1. **Start the container** with one of the [usage](#usage) examples and open the web UI at `http://<host>:3000`.
2. **Set a password.** Add `WEB_PASSWORD` to the container's environment. Without it, the dashboard is open to anyone who can reach the port, including the Settings page, and shows a warning banner. See [Security](#security).
3. **Add your services.** Open **Settings** and fill in each tab. Every field can also be given as an environment variable (see the [reference](#environment-variable-reference)), which is handy for automated setups. You only need the services you actually use.
4. **Give the chat box a brain.** The **Query** page uses Claude to answer questions, so it needs `ANTHROPIC_API_KEY` in the container's environment. This is a pay-per-use Anthropic API key, separate from a Claude subscription. The rest of the dashboard works without it.
5. **Keep the data volume.** Your settings, job history and the secret that keeps you signed in live in a SQLite database at `/app/data`. Mount a volume there or you will lose them each time the container is recreated.

Where to find each credential:

| Service | What to enter |
| :--- | :--- |
| Radarr, Sonarr, Prowlarr | The URL, and the API key from *Settings → General*. |
| SABnzbd | The URL, and the API key from *Config → General*. |
| qBittorrent | The Web UI URL, username and password. |
| Tautulli | The URL (without `/api/v2`) and the API key from *Settings → Web Interface*. |
| Plex | The server URL (e.g. `http://192.168.1.10:32400`) and an X-Plex-Token: open any movie in Plex Web, choose **⋯ → Get Info → View XML**, and copy the `X-Plex-Token=` value from the address bar. Treat it like a password. |
| TMDb | Your **API Read Access Token** (the long one, from your TMDb account's API settings), not the short v3 API key. |

> **Networking:** inside the container, `localhost` is the container itself, not your server. Use the LAN address of each service (for example `http://192.168.1.10:7878`), or, if the other apps are in the same Compose project or Docker network, their service names (`http://radarr:7878`).

### Usage

Here are some example snippets to help you get started creating a container. Docker Compose is recommended.

#### Docker Compose (recommended)

```yaml
---
services:
  plex-director:
    image: honeybeartech/plex-director-mcp:latest
    container_name: plex-director
    environment:
      - WEB_PASSWORD=choose-a-password
      - ANTHROPIC_API_KEY=sk-ant-your-key #optional, needed for the Query chat
      - RADARR_URL=http://192.168.1.10:7878 #optional, or set on the Settings page
      - RADARR_API_KEY=your_radarr_api_key #optional
      - PLEX_URL=http://192.168.1.10:32400 #optional
      - PLEX_TOKEN=your_plex_token #optional
      - TMDB_API_KEY=your_tmdb_read_access_token #optional
      - DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... #optional
    volumes:
      - /path/to/plex-director/data:/app/data
      - /path/to/ssh/id_ed25519:/ssh/id_ed25519:ro #optional, for host monitoring over SSH
    ports:
      - 3000:3000
    restart: unless-stopped
```

The image has a built-in health check (`docker ps` shows `healthy` once it is up), so you don't need to add one.

To keep your credentials out of the compose file, put them in a `.env`-style file next to it and reference it instead of listing them:

```yaml
    env_file:
      - plex-director.env
```

Then start it:

```bash
docker compose up -d
```

#### Docker CLI

```bash
docker run -d \
  --name=plex-director \
  -e WEB_PASSWORD=choose-a-password \
  -e ANTHROPIC_API_KEY=sk-ant-your-key \
  -p 3000:3000 \
  -v /path/to/plex-director/data:/app/data \
  --restart unless-stopped \
  honeybeartech/plex-director-mcp:latest
```

Add any other variables from the [reference](#environment-variable-reference) with more `-e` flags, or put them in a file and pass `--env-file plex-director.env`. For SSH host monitoring, also add `-v /path/to/ssh/id_ed25519:/ssh/id_ed25519:ro`.

> **`--env-file` is not the same as a `.env` file for Node.** Docker reads values literally: don't put quotes around values, and don't put a comment after a value on the same line (`KEY=abc # my key` becomes the value `abc # my key`). Put comments on their own line.

#### Claude Desktop via Docker

The same image is also the MCP server, which speaks over stdio. Tell Claude Desktop to run it with `docker run -i` in its config (**Settings → Developer → Edit Config**, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "plex-director": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/absolute/path/to/plex-director.env",
        "-v", "plex-director-data:/app/data",
        "honeybeartech/plex-director-mcp:latest"
      ]
    }
  }
}
```

Restart Claude Desktop and the `plex-director` server appears as a tool provider (17 tools, listed [below](#mcp-tools)). Notes:

- `-i` is required, since MCP talks over stdin/stdout. Don't add `-t`.
- No `-p` is needed. The web dashboard also starts inside this container, but you only need to publish its port if you want to open it from this container instead of from the Compose one.
- If you also run the long-lived container above, give both the same data volume (or bind mount) so they share settings and job history.
- The container keeps running if Claude closes its stdin; quitting Claude Desktop stops it, or use `docker stop`.

### Parameters

Container images are configured using parameters passed at runtime. These parameters are separated by a colon and indicate `<external>:<internal>` respectively. For example, `-p 8080:3000` would expose port `3000` from inside the container to be accessible from the host's IP on port `8080` outside the container.

| Parameter | Function |
| :---: | :--- |
| `-p 3000:3000` | The web dashboard. Change the left number to use a different port on your host. |
| `-e WEB_PASSWORD=` | Password for the web dashboard. **Strongly recommended.** |
| `-e ANTHROPIC_API_KEY=` | Enables the Query chat. |
| `-e RADARR_URL=` etc. | Service connection details; see the [reference](#environment-variable-reference). Optional, since they can be entered on the Settings page. |
| `-v /app/data` | The SQLite database: your saved settings, job history and login-session secret. **Mount a volume here.** |
| `-v /ssh/id_ed25519:ro` | *Optional.* A private SSH key for host monitoring (with `-e SSH_KEY_PATH=/ssh/id_ed25519`). |

### Environment variable reference

Nothing is required to start the container: it boots with no configuration and lets you fill things in on the Settings page.

**Service connections.** On first start these are copied into the database, and from then on **the value saved in the database wins** (that is what the Settings page edits). If you change one of these variables later and nothing happens, that is why; change it on the Settings page, or delete the database.

| Variable | Description |
| :--- | :--- |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr. Used for movie status, diagnosis, adding movies, and batch jobs. |
| `RADARR_DEFAULT_QUALITY_PROFILE` | *Optional.* The name of the quality profile new movies get when you add them. Leave it blank to use Radarr's first profile. Also on the Radarr tab of the Settings page. |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr. Optional; used for backups. |
| `PROWLARR_URL`, `PROWLARR_API_KEY` | Prowlarr, for indexer health and backups. |
| `SABNZBD_URL`, `SABNZBD_API_KEY` | SABnzbd, for the queue and for diagnosing missing media. |
| `QBITTORRENT_URL`, `QBITTORRENT_USER`, `QBITTORRENT_PASS` | qBittorrent Web UI. |
| `TAUTULLI_URL`, `TAUTULLI_API_KEY` | Tautulli, for streams and watch statistics. |
| `PLEX_URL`, `PLEX_TOKEN` | Plex, for searching what you own. |
| `PLEX_SKIP_LIBRARIES` | *Optional.* Comma-separated Plex library names to leave out of searches (whole names, any case), e.g. `Sports`. A library you name in a question, such as "in Sports", is still searched. Blank searches every library. Also on the Plex tab of the Settings page. |
| `TMDB_API_KEY` | TMDb **API Read Access Token**, for actor filmographies and the movie-choice grid. |
| `UBUNTU_HOSTS` | Comma-separated hosts to monitor over SSH, e.g. `192.168.1.10,192.168.1.11`. Add `:port` for a non-standard SSH port (`192.168.1.10:2222`). |
| `SSH_USER` | The SSH user for those hosts. |

**Container settings.** These are read from the environment every time and are never stored in the database or shown on the Settings page.

| Variable | Default | Description |
| :--- | :---: | :--- |
| `WEB_PASSWORD` | *(none)* | Requires a login for the dashboard. Changing it signs everyone out. |
| `WEB_PORT` | `3000` | The port the dashboard listens on inside the container. |
| `ANTHROPIC_API_KEY` | *(none)* | Anthropic API key for the Query chat. |
| `SSH_KEY_PATH` | *(none)* | Path (inside the container) to the private key for host monitoring. It must be readable by the container's user. |
| `SSH_KEY_PASSPHRASE` | *(none)* | The passphrase, if that private key is passphrase-protected. |
| `DISCORD_WEBHOOK_URL` | *(none)* | Discord webhook for job-completed and job-paused notifications. |
| `JOB_RUNNER_INTERVAL_SECONDS` | `60` | How often the job runner advances a started job by one movie (minimum `10`; `0` turns the runner off). |

### Read-only and non-root operation

By default the container runs as root, which lets it write to whatever you mount at `/app/data`. The image itself has no shell or package manager. If you would rather it didn't run as root, or want a read-only filesystem, both work; the data directory is the only place it writes, so it just has to be writable by the user you choose.

```yaml
services:
  plex-director:
    image: honeybeartech/plex-director-mcp:latest
    user: "1000:1000"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    volumes:
      - /path/to/plex-director/data:/app/data
    ports:
      - 3000:3000
```

Or with the CLI: `--user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges:true`.

Make sure the data directory is writable by that user first, for example `chown -R 1000:1000 /path/to/plex-director/data` (a Docker-created named volume is owned by root). If it is not, the container exits at startup with `SqliteError: unable to open database file`. If you use SSH host monitoring, the mounted key must also be readable by that user.

### Updating

Your settings and job history live in the data volume, so updating just replaces the container.

**Docker Compose**

```bash
docker compose pull plex-director
docker compose up -d
docker image prune
```

**Docker CLI**

```bash
docker pull honeybeartech/plex-director-mcp:latest
docker stop plex-director
docker rm plex-director
# ...then run the same `docker run` command as before
docker image prune
```

**Verify a download.** Every published image is signed with [cosign](https://docs.sigstore.dev/cosign/) using GitHub's OIDC identity (no keys to manage):

```bash
cosign verify \
  --certificate-identity-regexp "https://github.com/HoneyBearTech/plex-director-mcp/.*" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  honeybeartech/plex-director-mcp:latest
```

### Building locally

```bash
git clone https://github.com/HoneyBearTech/plex-director-mcp.git
cd plex-director-mcp
docker build -t plex-director-mcp .
```

`.dockerignore` keeps `.env`, the local database and other secrets out of the build context. Never bake secrets into an image; pass them at run time.

## Run without Docker (Claude Desktop)

Requires Node.js 24.

```bash
git clone https://github.com/HoneyBearTech/plex-director-mcp.git
cd plex-director-mcp
npm install
```

Create a `.env` file in the repo root with the services you use (all optional; you can also enter service details later on the Settings page):

```env
RADARR_URL=http://radarr:7878
RADARR_API_KEY=your_radarr_api_key
RADARR_DEFAULT_QUALITY_PROFILE=Your Profile Name
SONARR_URL=http://sonarr:8989
SONARR_API_KEY=your_sonarr_api_key
PROWLARR_URL=http://prowlarr:9696
PROWLARR_API_KEY=your_prowlarr_api_key
SABNZBD_URL=http://sabnzbd:8080
SABNZBD_API_KEY=your_sabnzbd_api_key
QBITTORRENT_URL=http://qbittorrent:8080
QBITTORRENT_USER=your_qbittorrent_user
QBITTORRENT_PASS=your_qbittorrent_password
TAUTULLI_URL=http://tautulli:8181
TAUTULLI_API_KEY=your_tautulli_api_key
PLEX_URL=http://plex:32400
PLEX_TOKEN=your_plex_token
TMDB_API_KEY=your_tmdb_read_access_token
ANTHROPIC_API_KEY=your_anthropic_api_key
UBUNTU_HOSTS=192.168.1.10,192.168.1.11
SSH_USER=your_ssh_username
SSH_KEY_PATH=/path/to/id_ed25519
SSH_KEY_PASSPHRASE=only_if_the_key_has_one
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
WEB_PORT=3000
WEB_PASSWORD=choose-a-password
```

See the [reference](#environment-variable-reference) for what each one does. Two things that commonly go wrong:

- **Comments go on their own line**, never after a value (`KEY=abc # note` makes the note part of the value in some tools).
- **A path with a space needs quotes around the whole value:** `SSH_KEY_PATH="/Users/me/.ssh/my key"`, not `/Users/me/.ssh/'my key'`.

Add the server to Claude Desktop (**Settings → Developer → Edit Config**):

```json
{
  "mcpServers": {
    "plex-director": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/plex-director-mcp/src/index.ts"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
```

Replace the path with the real one and restart Claude Desktop. The server starts the web dashboard on `WEB_PORT` in the same process.

## Web dashboard

The dashboard runs on `WEB_PORT` (default `3000`) in the same process as the MCP server.

| Page | What it shows |
| :--- | :--- |
| **Query** | A chat box that answers questions about your library using Claude and your services. Search results appear as a table with posters (shows add seasons, episodes and watch progress), showing the first 50 with a button to expand. Follow-up questions keep the context; **New chat** starts over. Needs `ANTHROPIC_API_KEY`. |
| **Server Status** | Live Plex streams and watch statistics (from Tautulli). |
| **Node Utilization** | CPU, memory, disk, uptime and container health for each SSH host. A host that is unreachable shows why; a host whose SSH key changed is flagged with a **Trust new key** button (see [Security](#security)). |
| **Queues** | The SABnzbd and qBittorrent download queues. |
| **Indexers** | Every Prowlarr indexer with its status (healthy, recent failures, backing off, disabled) and Prowlarr's own health warnings. |
| **Jobs** | Batch jobs and their progress. Read-only: start, pause and cancel jobs from Claude. |
| **Settings** | Connection details for every service. Secrets are never sent back to the browser, only whether they are set. |

Set `WEB_PASSWORD` to require a login: a sign-in page, then a signed 7-day session cookie (marked `Secure` automatically when served over HTTPS). Failed logins are rate-limited. Logging out only clears your browser's copy, so to revoke every session, change the password.

The health check is `GET /healthz`, which returns `{"ok":true}` and needs no login. The Docker image runs it for you every 30 seconds using Node itself (the image has no `curl`), on whatever `WEB_PORT` is set to.

## MCP tools

Seventeen tools are available to Claude Desktop. The four marked ★ are also what the dashboard's Query chat uses.

**Your library**

| Tool | What it does |
| :--- | :--- |
| ★ `search_plex_library` | Searches the movies and TV shows in your Plex library by genre, actor, title, year and/or library (e.g. `4k`), across all libraries, or only movies or only shows. Shows report seasons, episodes and watch progress. Paged for large results. |
| ★ `resolve_actor_filmography` | An actor's TMDb filmography with each movie marked as in Plex or not, filterable by year range, owned/missing, and library. |
| ★ `check_movie_status` | Whether a movie is in Radarr, and its monitoring status, with artwork. |
| ★ `diagnose_missing_media` | Traces a movie through Radarr metadata, history and the download queues to find why it is missing. |
| `search_and_select_movies` | Searches TMDb and shows a numbered grid of matches. |
| `confirm_selected_choices` | Adds the chosen numbers from that grid to Radarr as monitored movies and starts a download search. Already-present movies are reported, not added twice. Uses the quality profile you name, otherwise the default set on the Radarr tab of the Settings page, otherwise Radarr's first profile; and Radarr's first root folder unless you name another. |

**Downloads and indexers**

| Tool | What it does |
| :--- | :--- |
| `manage_stalled_downloads` | `AUDIT` lists stalled or slow qBittorrent downloads; `PURGE_STALLED` deletes them and their files. |
| `check_indexer_health` | Reports failing, backing-off and disabled Prowlarr indexers, and Prowlarr's own warnings. |

**Background jobs**

| Tool | What it does |
| :--- | :--- |
| `plan_media_upgrade` | Finds movies without a file or below 1080p and schedules them as a batch job (movies only, up to 25 at a time by default). |
| `get_background_jobs` | Lists jobs and their progress. |
| `update_job_status` | `PAUSE`, `RESUME` or `CANCEL` a job. Resuming a job is what starts it. |
| `execute_next_job_step` | Searches the next movie in a job by hand. Started jobs are also advanced automatically, one movie a minute, by the job runner. |

**Infrastructure and analytics**

| Tool | What it does |
| :--- | :--- |
| `get_cluster_infrastructure_health` | CPU, memory and Docker container health for each SSH host. |
| `get_cluster_hardware_analytics` | CPU and memory per host as a table. |
| `run_cluster_backup` | Asks Radarr, Sonarr and Prowlarr (whichever are configured) to run their built-in database backups, waits for each (up to about a minute; a slower one is reported as still running), and confirms a new backup file appeared, with its name, size and time. The backups stay in each app's own backup folder; nothing is copied. |
| `get_plex_activity` | Live playback streams and transcoding load, via Tautulli. |
| `get_library_analytics` | Most-watched titles, top users, platforms and libraries, via Tautulli. |

**How batch jobs work.** `plan_media_upgrade` creates a job in the `PENDING` state; nothing runs until you `RESUME` it. A started job is then advanced by the job runner, one Radarr search per interval (default 60 seconds), so a large batch cannot flood your indexers. A paused, cancelled or pending job is never touched, and a job that fails three times in a row (for example because Radarr is down) is paused and reported to Discord.

## Security

- **Run it on a trusted network.** It is designed for a home LAN and is not designed or tested to be exposed to the public internet. If you do reach it from outside, put it behind HTTPS and a reverse proxy you trust. See [SECURITY.md](SECURITY.md) to report a vulnerability.
- **Set `WEB_PASSWORD`.** Without it, anyone who can reach the port can use the dashboard and change its settings.
- **Secrets stay on the server.** The Settings page never returns a saved key or token, and Plex artwork is fetched through a server-side proxy so the Plex token never reaches your browser.
- **SSH host monitoring uses key authentication, and remembers each host's key on first use.** The first time a host connects, its key fingerprint is saved; from then on a different key is refused before any command is sent, and the Node Utilization page shows the host as offline with a **Trust new key** button for when you have legitimately rebuilt it. That protects against a host being swapped for an impostor *after* first contact, so if you want certainty about the first connection, compare the fingerprint with `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf -`. Use a dedicated, unprivileged user, and keep it on a network you trust.
- **Some tools change things.** `confirm_selected_choices` adds movies and starts downloads, `manage_stalled_downloads` with `PURGE_STALLED` deletes torrents and their files, and the job runner triggers searches. Claude Desktop asks for your permission before it uses a tool, so review what it proposes.
- The image runs as root by default; see [read-only and non-root operation](#read-only-and-non-root-operation) to lock it down.

## Development

```bash
npm install
npm start           # MCP server (stdio) + dashboard on WEB_PORT
npm test            # the test suite
npx tsc --noEmit    # typecheck the backend and the tests
```

The dashboard is a separate npm project in `web/` (React, Vite and TypeScript, with its own `package.json`):

```bash
cd web
npm install
npm run dev         # dev server on :5173, proxies /api to the backend on :3000
npx tsc --noEmit
npm run build       # static assets the backend serves; the Dockerfile does this for you
```

**Tests** use Node's built-in test runner, so there is nothing extra to install. They run against a throwaway database, never read your real `.env`, have your service credentials removed from the environment, and fail every HTTP request unless a test installs a fake, so running them can't touch your real services. `test/isolation.test.ts` fails the run if any of that ever breaks.

**Runtime notes**

- State (settings, job history, the login secret) is a SQLite database at `data/plex_director.db`, or `/app/data` in the container.
- Uses the official MCP SDK.
- The Query chat calls the Anthropic API with the tools above; nothing else leaves your network except calls to TMDb and, if you set it, Discord.

## CI/CD

`.github/workflows/ci.yml` has three jobs:

- **Typecheck & audit** (`check`) runs on every push and pull request against `main`: the TypeScript typecheck, the test suite, `npm audit --audit-level=high`, and the same typecheck and audit for the dashboard in `web/`.
- **Build, smoke test, and publish** (`publish`) runs on every push to `main`, every `v*.*.*` tag push and every pull request, once `check` passes. Every run builds the image and boots it with dummy configuration to confirm it starts. Pushes then publish to both registries (branch pushes tag `latest` and the commit SHA; tag pushes also get the version, e.g. `1.2.3` and `1.2`), run a [Docker Scout](https://docs.docker.com/scout/) vulnerability scan (reported in the job summary, non-blocking for now), and sign both images with cosign.
- **Create GitHub Release** (`release`) runs only on `v*.*.*` tag pushes, after `publish` succeeds, and creates a release with generated notes.

Alongside it: [CodeQL](https://codeql.github.com/) analyses the TypeScript on every push and pull request and weekly, [OpenSSF Scorecard](https://scorecard.dev/) scores the repo's supply-chain practices weekly (see the badge above), and Dependabot opens weekly PRs for npm, Docker base image and GitHub Actions updates, which auto-merge once CI passes unless they are a major version bump.

## License

[MIT](LICENSE)
