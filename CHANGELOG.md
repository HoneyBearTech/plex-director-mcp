# Changelog

All notable changes to Plex Director are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Dependency updates from Dependabot are left out unless they fix
a security problem.

## [Unreleased]

### Added

- **`trust_new_host_key` MCP tool**: forgets a monitored host's remembered SSH key after you rebuilt it, the
  Claude Desktop counterpart of the dashboard's **Trust new key** button. Not available to the Query chat.

### Security

- **Trusting a changed SSH host key from the dashboard needs `WEB_PASSWORD`.** Without a login anyone on the
  network could use it to make an impostor the trusted host; the button is replaced by an explanation, and the
  API answers 403. Use `trust_new_host_key` in Claude Desktop instead.
- **Poster downloads are limited.** `check_movie_status` only downloads a poster over HTTPS from TMDb's image
  server or the placeholder service, with no redirects, a 10-second timeout and a 5 MB cap. The URL comes
  from Radarr's metadata, and could otherwise point anywhere on your network.
- **The image proxies only pass on images.** The dashboard's Plex and Tautulli artwork routes refuse a reply
  that isn't JPEG, PNG, WebP or GIF, and mark images `Cache-Control: private` (they sit behind the login).
- **SSH probes are bounded:** one connection and command must finish within 30 seconds, and more than 1 MB of
  output ends it.
- **Jobs can't be revived.** `update_job_status` only makes changes that fit the job's state: a completed or
  cancelled job stays that way. `plan_media_upgrade` takes at most 100 movies per job.
- The torrent hash in qBittorrent delete requests is URL-encoded.

### Fixed

- `manage_stalled_downloads` with `PURGE_STALLED` no longer says the releases were "blocklisted": it deletes
  them in qBittorrent only, and now says that Radarr and Sonarr weren't told.

## [1.3.0] - 2026-10-16

### Changed

- **The Docker image runs as a non-root user** (UID and GID 65532, distroless's `nonroot`) instead of root.
  A new named volume gets the right owner automatically. **Upgrading:** a data folder or volume written by an
  earlier version belongs to root, so `chown -R 65532:65532` it once (or set `user:` to its owner); until then
  the container stops at start-up and prints the command to run. See
  [docs/upgrading.md](docs/upgrading.md#upgrading-to-130-the-container-no-longer-runs-as-root).

### Added

- **Linting and formatting in CI.** [Biome](https://biomejs.dev/) checks the backend, tests and dashboard on
  every pull request (`npm run check` locally); lint errors, lint warnings and unformatted files fail the
  build. The codebase was reformatted once to match, and every service response is now typed.

### Security

- **The Query chat now validates the model's tool arguments.** Every tool checks its input against its
  schema before it runs, so the web chat gets the same validation MCP clients already had; input that
  doesn't match is returned to the model as an error instead of reaching the tool.

### Fixed

- A local `docker build` copied the host's `web/node_modules` into the image build and failed:
  `.dockerignore` patterns only matched at the top level. They now match in every folder, which also keeps
  stray `.env`, key and database files in subfolders out of the build context.
- The dashboard's polling hook now always calls the latest fetch function instead of the one from the first
  render.

## [1.2.0] - 2026-10-15

### Added

- **Official MCP registry listing.** `server.json` describes the Docker image for the
  [MCP registry](https://registry.modelcontextprotocol.io/), the image carries the registry's
  `io.modelcontextprotocol.server.name` label, and each version tag publishes the listing from CI using
  GitHub OIDC (no stored token). CI also checks on every pull request that the label matches `server.json`.
- **Usage guidance for assistants.** The MCP server now sends `instructions` (which tool answers which
  question; confirm before changing anything), the same guidance ships as an Agent Skill in
  `skills/plex-director/SKILL.md`, and the Query chat uses it too. All three come from `src/guidance.ts`.
- **TV shows.** The Plex search finds TV shows as well as movies, with their season and episode counts and
  how much you have watched (#44), and an actor's filmography includes TV shows, matched to Plex by TMDb id
  (#45).
- `check_series_completeness` and `find_series_gaps`: "do I have every episode?" from Sonarr's episode list,
  and which shows are missing aired episodes, most missing first. Unaired episodes and specials are never
  counted as missing (#46).
- `check_series_status` and `diagnose_missing_episodes`: what Sonarr knows about a show, and why aired
  episodes have no file, from Sonarr's history and download queue (#47).
- `get_upcoming_episodes`: "what's on this week?" and "when does this show come back?", from Sonarr's
  calendar, with premieres and finales flagged (#48).
- Watch-state and recency filters for the Plex search: unwatched, in progress, watched, "not watched in N
  years", and sorting by recently added or last watched (#49).
- `get_on_deck`: "what should I watch next?" from Plex's On Deck (#50).
- `search_episodes`: find individual TV episodes by title, plot (within a named show), air date, or season
  premiere and finale (#51).
- Attribute filters for the Plex search: network or studio, content rating, audience rating, release years,
  and "added in the last N days" (#52).
- `find_series_by_quality`: find TV shows by the video quality Sonarr downloaded, such as shows held only in
  720p (#53).
- Plex support: a Plex URL and token on the Settings page (#19), and the `search_plex_library` tool, which
  searches your library by genre, actor, title and year (#20).
- `resolve_actor_filmography` marks which of an actor's movies are in Plex (#21, #22), and both it and the
  Plex search can be narrowed to a library such as `4k` (#33).
- Plex search results and actor filmographies appear as a table with posters in the Query chat (#23).
- Plex libraries such as Sports can be left out of searches unless you name them (`PLEX_SKIP_LIBRARIES`)
  (#44).
- An **Indexers** page on the dashboard, sharing Prowlarr's health logic with `check_indexer_health` (#26).
- A read-only **Jobs** page on the dashboard (#27).
- An automatic background job runner: a started job is advanced one movie per interval
  (`JOB_RUNNER_INTERVAL_SECONDS`, default 60 seconds), and a job that fails three times in a row is paused
  and reported to Discord (#28).
- The Query chat remembers the conversation, so follow-up questions keep their context; **New chat** starts
  over (#30).
- Optional password protection for the dashboard (`WEB_PASSWORD`), with a signed 7-day session cookie and
  rate-limited logins (#31).
- A test suite, run in CI, that can't touch real services, databases or credentials (#32).
- The default Radarr quality profile for new movies is a setting (`RADARR_DEFAULT_QUALITY_PROFILE`) (#38).
- A built-in Docker `HEALTHCHECK` on `GET /healthz` (#41).
- SSH keys with a passphrase are supported (`SSH_KEY_PASSPHRASE`) (#40).

### Changed

- The Plex search shows one row per movie, with every library that holds it, a 50-row preview with a button
  to show all, and shorter, cleaner chat replies (#34).
- `get_cluster_infrastructure_health` and `get_cluster_hardware_analytics` use the same single SSH
  connection per host as the dashboard, probe hosts in parallel, and read hosts from `UBUNTU_HOSTS` (#24).
- The dashboard and `manage_stalled_downloads` share one qBittorrent session (#29).
- The README was rewritten for the app's current features, with Docker Compose and Docker CLI guides
  (#35, #43).

### Fixed

- The Docker version badge in the README (#16).
- Broken TMDb poster URLs in `search_and_select_movies` (#17).
- Labels and play counts in `get_library_analytics` (#18).
- `get_cluster_hardware_analytics` returned made-up CPU and memory numbers instead of the real ones (#24).
- `confirm_selected_choices` didn't add anything to Radarr. It now adds the chosen movies as monitored and
  starts a download search, and reports movies that are already there instead of adding them twice (#25).
- Plex results were cut off at 100, and follow-up questions in the chat re-showed old tables (#33).
- dotenv printed a line on stdout, which belongs to the MCP protocol and can break stricter MCP clients
  (#36).
- The MCP server reported a made-up version instead of the package's real one (#37).
- `run_cluster_backup` now asks Radarr, Sonarr and Prowlarr (Prowlarr was never asked before) to back up,
  waits for each, and confirms a new backup file appeared, instead of reporting success without checking
  (#39).
- A flaky SSH test (#42).

### Security

- SSH host monitoring verifies each host's key: the key is remembered the first time a host connects, and a
  changed key is refused until you approve it on the Node Utilization page (#40).
- Updated two dependencies with high-severity advisories: `@modelcontextprotocol/sdk` 1.30.0 to 1.32.1
  ([GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)), and `source-map-js` 1.2.1 to
  1.2.2 in the dashboard ([GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)) (#66).
- Saving a different URL for a service on the Settings page while leaving its key, token or password blank
  is now refused. Before, the saved secret was kept and sent to the new URL, so anyone able to save
  settings could collect it with a server of their own.
- Without `WEB_PASSWORD`, the dashboard now answers only to host names a DNS-rebinding web page can't use
  (IP addresses, `localhost`, single-word names, `.local` / `.lan` / `.home.arpa` / `.internal` names) plus
  any listed in the new `WEB_ALLOWED_HOSTS`. **If you reach a password-less dashboard through a public
  name, such as a reverse proxy's, add that name to `WEB_ALLOWED_HOSTS` or set `WEB_PASSWORD`.**
- Every dashboard response now forbids framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), sets
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and no longer sends `X-Powered-By`.

## [1.1.0] - 2026-09-17

### Added

- A web dashboard alongside the MCP server, on port 3000: Server Status, Node Utilization, Queues and a
  live-editable Settings page, with a light, dark or system appearance (#9).
- The Query page is a chat that uses Claude's tool calling (`check_movie_status`, `diagnose_missing_media`)
  to answer questions such as "Do I have the F1 movie?". It needs `ANTHROPIC_API_KEY` (#9).
- Posters and user avatars on Server Status, fetched through the server so the Tautulli API key never
  reaches the browser (#9).
- Node Utilization shows each host's real hostname, disk usage and uptime (#9).
- Multi-arch images for `linux/amd64` and `linux/arm64`.
- Published images are signed with cosign, keylessly, using GitHub's OIDC identity.
- Each image is started and checked before it is published, on pull requests as well as on `main`.
- Dependabot updates for npm, Docker base images and GitHub Actions, merged automatically once CI passes
  unless they are a major version bump.
- OpenSSF Scorecard, and a `SECURITY.md` pointing to GitHub's private vulnerability reporting.

### Changed

- The Queues page shows only the qBittorrent items that are downloading (#9).
- Each Node Utilization poll uses one SSH connection per host instead of nine, which could trip fail2ban or
  connection-rate limits on the hosts.
- Every GitHub Action is pinned to a commit SHA and both Dockerfile base images to a digest, and workflows
  start with read-only permissions.

### Fixed

- `diagnose_missing_media` reported owned movies as missing (#9).
- Mislabelled categories on Server Status: Recently Watched, Most Active Platforms and Most Concurrent
  Streams (#9).
- A saved API key was wiped when the Settings page received a value of only spaces.
- An unexpected poster content type failed the whole chat turn instead of falling back to text.
- Unknown `/api/*` routes returned the dashboard page instead of a 404.
- Incomplete escaping in TMDb overviews in Markdown output.

### Security

- The web server is rate-limited (300 requests a minute per IP address), fixing a high-severity CodeQL
  finding.

## [1.0.0] - 2026-09-17

### Added

- The first release: an MCP server for Claude Desktop with 16 tools for Radarr, Sonarr, Prowlarr, SABnzbd,
  qBittorrent, Tautulli, TMDb and Linux hosts over SSH: movie status and diagnosis, Plex activity and library
  analytics through Tautulli, actor filmographies, TMDb movie search, indexer health, stalled downloads,
  batch upgrade jobs stored in SQLite, cluster backups and host health, and optional Discord notifications.
- A Docker image on a distroless runtime base, published to GitHub Container Registry and Docker Hub by CI,
  with a Docker Scout vulnerability scan.
- CodeQL analysis of the source.
- The MIT license.

[Unreleased]: https://github.com/HoneyBearTech/plex-director-mcp/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/HoneyBearTech/plex-director-mcp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/HoneyBearTech/plex-director-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/HoneyBearTech/plex-director-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/HoneyBearTech/plex-director-mcp/releases/tag/v1.0.0
