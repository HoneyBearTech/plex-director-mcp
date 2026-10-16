# External interfaces

Every way people and other software interact with a running Plex Director, what each one expects and
produces, and where it is specified. Which of these should be reachable from where is described in the
[assurance case](assurance-case.md#attack-surface).

## Interfaces Plex Director offers

| Interface | Where | Who uses it | Authentication | Specification |
| --- | --- | --- | --- | --- |
| MCP server | stdin/stdout of the process (`docker run -i` or `tsx src/index.ts`) | MCP clients such as Claude Desktop | whoever launches the process; the client confirms each tool call | [below](#mcp-tools) and the README's [MCP tools](../README.md#mcp-tools) |
| Web dashboard | `http://<host>:3000/` (`WEB_PORT`) | people, in a browser | `WEB_PASSWORD` sign-in, then a session cookie | the README's [Web dashboard](../README.md#web-dashboard) |
| Dashboard HTTP API | `/api/…` on the same port | the dashboard's frontend | session cookie `pd_session` (when `WEB_PASSWORD` is set) | [`api/openapi.json`](api/openapi.json) (OpenAPI 3.1) |
| Health check | `GET /healthz` on the same port | Docker, monitoring | none | returns `{"ok":true}` |
| Configuration | environment variables, and the Settings page | operators | access to the host, or a dashboard session | [below](#configuration) |
| Container image | `honeybeartech/plex-director-mcp`, `ghcr.io/honeybeartech/plex-director-mcp` | operators | cosign signature to verify | [below](#container-image) |

### MCP tools

The server speaks the Model Context Protocol (JSON-RPC 2.0 over stdio) with the official MCP SDK and
reports itself as `plex-director` with the version from `package.json`. Its `initialize` result carries
`instructions`: usage guidance from `src/guidance.ts`, also published as the Agent Skill in
`skills/plex-director/SKILL.md`. Arguments are validated against
each tool's zod schema. Replies are Markdown text, sometimes with images (posters), and search tools also
attach `structuredContent` rows. The 12 tools marked ★ are also the only tools the dashboard's Query chat
can use. **Changes** marks tools that change something in your services.

| Tool | Changes | What it does |
| --- | :---: | --- |
| ★ `search_plex_library` | | Search Plex movies and shows by title, genre, actor, year, library, watch state, network, rating and date added. |
| ★ `search_episodes` | | Find TV episodes by title (and, within a named show, plot), air date, premiere or finale. |
| ★ `get_on_deck` | | Plex's On Deck: what to watch next, with progress. |
| ★ `resolve_actor_filmography` | | An actor's TMDb movies and shows, each marked as in Plex or not. |
| ★ `check_series_completeness` | | Which aired episodes of one show are downloaded or missing, from Sonarr. |
| ★ `find_series_gaps` | | Shows missing aired episodes, most missing first. |
| ★ `find_series_by_quality` | | Shows by the video resolution Sonarr downloaded. |
| ★ `check_series_status` | | What Sonarr knows about one show: monitoring, profile, next airing, queue. |
| ★ `diagnose_missing_episodes` | | Why aired episodes have no file, from Sonarr history and queue. |
| ★ `get_upcoming_episodes` | | What airs in the next days, or when one show returns, from Sonarr's calendar. |
| ★ `check_movie_status` | | Whether a movie is in Radarr and monitored, with artwork. |
| ★ `diagnose_missing_media` | | Why a movie is missing, from Radarr metadata, history and the SABnzbd queue. |
| `search_and_select_movies` | | Search TMDb and show a numbered grid of matches (remembers the grid for the next tool). |
| `confirm_selected_choices` | yes | Add the chosen grid entries to Radarr as monitored movies and start a download search. |
| `manage_stalled_downloads` | yes (`PURGE_STALLED`) | `AUDIT` lists stalled or slow qBittorrent downloads; `PURGE_STALLED` deletes them and their files. |
| `check_indexer_health` | | Failing, backing-off and disabled Prowlarr indexers, and Prowlarr's warnings. |
| `plan_media_upgrade` | yes (creates a job) | Schedule a `PENDING` batch of movies with no file or below 1080p (TV is refused). |
| `get_background_jobs` | | List batch jobs and their progress. |
| `update_job_status` | yes | `PAUSE`, `RESUME` (start) or `CANCEL` a job. |
| `execute_next_job_step` | yes | Run the next Radarr search of a job now. |
| `get_cluster_infrastructure_health` | | CPU, memory and Docker container health per SSH host. |
| `get_cluster_hardware_analytics` | | CPU and memory per host as a table. |
| `run_cluster_backup` | yes | Ask Radarr, Sonarr and Prowlarr to run their built-in backups and confirm a new file appeared. |
| `get_plex_activity` | | Live streams and transcoding load, via Tautulli. |
| `get_library_analytics` | | Most-watched titles, top users, platforms and libraries, via Tautulli. |

### Dashboard HTTP API

The OpenAPI description, [`api/openapi.json`](api/openapi.json), lists every route with its parameters,
request bodies and response shapes. In summary:

| Area | Routes |
| --- | --- |
| Sign-in (public) | `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` |
| Server status | `GET /api/status/activity`, `GET /api/status/library-analytics`, `GET /api/status/image` |
| Hosts | `GET /api/nodes/health`, `POST /api/nodes/trust-new-key` |
| Download queues | `GET /api/queues/sabnzbd`, `GET /api/queues/qbittorrent` |
| Indexers | `GET /api/indexers/health` |
| Jobs (read-only) | `GET /api/jobs` |
| Settings | `GET /api/settings`, `PUT /api/settings/{service}` |
| Query chat | `POST /api/chat/movies` |
| Plex artwork | `GET /api/plex/image` |

Conventions:

- JSON in and out (`Content-Type: application/json`, at most 1 MB), apart from the two image routes, which
  return image bytes. Errors are `{"error": "…"}`.
- `403` means the `Host` name isn't allowed (only when `WEB_PASSWORD` is unset; see `WEB_ALLOWED_HOSTS`),
  `401` means not signed in (only when `WEB_PASSWORD` is set), `400` a bad parameter, `404` an unknown
  route, service or host, `413` a body over 1 MB, `429` too many requests (300 per minute per address, or
  10 failed sign-ins per 15 minutes), and `502` that the service behind the route failed or is not
  configured.
- There is no CORS support: the API is meant for the dashboard on the same origin.
- The API is internal to the dashboard and may change between versions; it is not a stable public API.

### Configuration

Every variable is described in the README's
[environment variable reference](../README.md#environment-variable-reference). Two kinds:

- **Service connections** (`RADARR_URL`, `RADARR_API_KEY`, `RADARR_DEFAULT_QUALITY_PROFILE`, `SONARR_*`,
  `PROWLARR_*`, `SABNZBD_*`, `QBITTORRENT_URL`/`_USER`/`_PASS`, `TAUTULLI_*`, `PLEX_URL`, `PLEX_TOKEN`,
  `PLEX_SKIP_LIBRARIES`, `TMDB_API_KEY`, `UBUNTU_HOSTS`, `SSH_USER`): copied into the database on first
  start; from then on the value saved in the database (edited on the Settings page) wins.
- **Container settings**, read from the environment every time and never stored or shown: `WEB_PASSWORD`,
  `WEB_ALLOWED_HOSTS`, `WEB_PORT`, `ANTHROPIC_API_KEY`, `SSH_KEY_PATH`, `SSH_KEY_PASSPHRASE`, `DISCORD_WEBHOOK_URL`,
  `JOB_RUNNER_INTERVAL_SECONDS`.

Outside Docker, a `.env` file in the repository root is read at start-up (`src/env.ts`).

### Container image

| Property | Value |
| --- | --- |
| Registries | Docker Hub `honeybeartech/plex-director-mcp`, GHCR `ghcr.io/honeybeartech/plex-director-mcp` |
| Architectures | `linux/amd64`, `linux/arm64` |
| Tags | `latest` (main), `<major>.<minor>.<patch>`, `<major>.<minor>`, `sha-<commit>` |
| Base | `gcr.io/distroless/nodejs24-debian12`, pinned by digest; no shell or package manager |
| Command | `dist/index.js` (the MCP server on stdio, the dashboard and the job runner) |
| Label | `io.modelcontextprotocol.server.name=io.github.HoneyBearTech/plex-director-mcp`, matching [`server.json`](../server.json) for the official MCP registry |
| Port | `3000/tcp` (`EXPOSE 3000`; follows `WEB_PORT`) |
| Volume | `/app/data` (SQLite database: settings, credentials, jobs, session secret, SSH host keys). The only path written to. |
| Optional mount | a private SSH key, read-only, at the path given in `SSH_KEY_PATH` |
| Health check | built in: every 30 s, timeout 5 s, start period 15 s, 3 retries; Node fetches `http://127.0.0.1:$WEB_PORT/healthz` |
| User | `65532:65532` (distroless `nonroot`) from 1.3.0, root before; runs as any user that can write `/app/data` |
| Signature | cosign keyless (GitHub OIDC); see [verifying-releases.md](verifying-releases.md) |

## Interfaces Plex Director uses

All of these are outgoing: none of these services connect to Plex Director. URLs and credentials come from
the settings store, except TMDb's and Anthropic's fixed addresses. Each axios client has a 10-second
timeout.

| Service | Used for | Protocol and authentication | Endpoints called |
| --- | --- | --- | --- |
| Radarr | movie status and diagnosis, adding movies, batch-job searches, backups | HTTP(S) REST v3, `X-Api-Key` header | `GET /api/v3/movie`, `/movie/lookup`, `/movie/lookup/tmdb`, `/history`, `/qualityprofile`, `/rootfolder`, `/system/backup`, `/command/{id}`; `POST /api/v3/movie` (add), `POST /api/v3/command` (`MoviesSearch`, `Backup`) |
| Sonarr | TV completeness, status, diagnosis, calendar, quality, backups | HTTP(S) REST v3, `X-Api-Key` header | `GET /api/v3/series`, `/episode`, `/episodefile`, `/history/series`, `/queue`, `/calendar`, `/qualityprofile`, `/system/backup`, `/command/{id}`; `POST /api/v3/command` (`Backup`) |
| Prowlarr | indexer health, backups | HTTP(S) REST v1, `X-Api-Key` header | `GET /api/v1/indexer`, `/indexerstatus`, `/health`, `/system/backup`, `/command/{id}`; `POST /api/v1/command` (`Backup`) |
| SABnzbd | download queue, missing-media diagnosis | HTTP(S) API, `apikey` query parameter | `GET` the configured URL with `mode=queue&output=json` |
| qBittorrent | download queue, stalled-download clean-up | HTTP(S) Web API v2, username/password login then `SID` cookie | `POST /api/v2/auth/login`, `GET /api/v2/torrents/info`, `POST /api/v2/torrents/delete` |
| Tautulli | streams, watch statistics, artwork for those | HTTP(S) API v2, `apikey` query parameter | `cmd=get_activity`, `get_home_stats`, `pms_image_proxy` |
| Plex Media Server | library, episode and On Deck search; artwork | HTTP(S), `X-Plex-Token` header, JSON | `GET /library/sections`, `/library/sections/{id}/all`, `/library/sections/{id}/genre`, `/library/metadata/{id}/allLeaves`, `/library/onDeck`, `/hubs/search`, `/photo/:/transcode` |
| TMDb | actor filmographies, movie search, posters | HTTPS `https://api.themoviedb.org/3`, Bearer read-access token | `GET /search/person`, `/person/{id}/movie_credits`, `/person/{id}/tv_credits`, `/search/movie`, `/movie/{id}` |
| Anthropic API | the dashboard's Query chat | HTTPS via `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` | Messages API, with tool use |
| Linux hosts | CPU, memory, disk, uptime and container health | SSH (ssh2), public-key auth, host key pinned on first use | one fixed read-only shell script per probe (`hostname`, `top`, `free`, `df`, `docker ps`, `/proc/uptime`) |
| Discord | job completed / job paused notifications | HTTPS webhook (`DISCORD_WEBHOOK_URL`), JSON embed | `POST <webhook URL>` |
| Poster hosts | artwork for `check_movie_status` | HTTPS `GET` of the poster URL Radarr or TMDb reports | one image per call |
