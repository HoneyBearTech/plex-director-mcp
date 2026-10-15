# Roadmap

This is where Plex Director intends to go over roughly the next year (from October 2026), and what it
deliberately won't do. It is a statement of intent, not a promise: plans change as the project learns, and
this page is updated when they do. Decisions about scope are made as described in
[GOVERNANCE.md](../GOVERNANCE.md); ideas and requests are welcome in
[GitHub Issues](https://github.com/HoneyBearTech/plex-director-mcp/issues). Anything below that is not
built yet is marked **Planned**.

## Where it stands

Plex Director is one Node.js process that is both an MCP server for Claude Desktop (25 tools) and a web
dashboard with a Claude-powered Query chat. **v1.0.0** and **v1.1.0** (September 2026) are released as
signed multi-arch images on Docker Hub and GHCR.

What works today:

- **Library search** across every Plex library, movies and TV shows together: genre, actor, title, year,
  library (for example only 4K), watch state, "not watched in N years", network or studio, content rating,
  audience rating, decade and recently added; individual episodes by title, plot (within a show) and air
  date; On Deck.
- **Owned versus missing** for an actor's movies and shows, from TMDb.
- **TV completeness and status** from Sonarr: which aired episodes are missing and why, which shows have
  gaps, what airs this week, when a show returns, and shows by downloaded quality.
- **Movies**: status, diagnosis of why one is missing, and adding movies to Radarr through a
  pick-then-confirm grid with a configurable default quality profile.
- **Downloads and indexers**: SABnzbd and qBittorrent queues, stalled-torrent clean-up, Prowlarr indexer
  health.
- **Batch jobs**: planned movie upgrades run by a rate-limited job runner, one search per minute, with
  pause, resume and cancel.
- **Hosts**: CPU, memory, disk, uptime and container health over SSH, with host keys pinned on first use;
  Servarr backups on demand.
- **Dashboard**: optional password sign-in, a Settings page where secrets are write-only, and pages for
  status, hosts, queues, indexers and jobs.

## Over the following year

**Storage clean-up for TV** (Planned)
- **Biggest shows:** rank shows by how much disk they use in Sonarr.
- **Big shows nobody watches:** shows not watched in years that take a lot of space, as clean-up
  candidates (Sonarr size combined with Plex or Tautulli watch history).
- These start as read-only reports. Any bulk TV action added later will be explicit, confirmed and
  rate-limited like the movie job system.

**Adding TV series** (Planned, undecided)
- Whether the assistant should add series to Sonarr, the way it adds movies to Radarr, or stay search-only
  for TV, is still open. If it is built, it will use the same search-then-confirm flow, with configurable
  Sonarr defaults (quality profile, root folder, series type, which seasons to monitor) rather than
  anything hard-coded to one install.

**Smaller search additions** (Planned)
- Continuing, ended or upcoming status for shows (from Sonarr), and a director filter for cross-media
  answers.

**Working with other AI clients**
- **Planned:** routing guidance for the tools written once and shared by the MCP server's `instructions`,
  a `SKILL.md` in the Agent Skills format, and the Query chat's system prompt, so the three cannot drift
  apart.
- **Planned:** a listing in the [official MCP registry](https://registry.modelcontextprotocol.io/): a
  `server.json` describing the Docker image, the registry label on the image, and a release job that
  publishes each new version.

**Security and project health**
- **Planned:** a linter and formatter in CI, with warnings failing the build.
- **Done (October 2026):** a test coverage floor in CI (80% of lines; 93% today), secret scanning with
  gitleaks, dependency review and a DCO sign-off check on every pull request.
- **Done (October 2026, first shipped in v1.2.0):** an SPDX SBOM and SLSA build provenance attached to every
  published image, alongside the existing cosign signatures, and the `LICENSE` file inside the image and on
  each GitHub Release.
- **Planned:** browser hardening headers on the dashboard (a Content-Security-Policy that forbids framing,
  `X-Content-Type-Options: nosniff`, no `X-Powered-By`) and a `Host` header check against DNS rebinding.
- **Planned:** make the image vulnerability scan block publishing on fixable critical and high findings
  (today it reports only).
- **Planned:** an accessibility check of every dashboard page (automated and keyboard-only), see
  [accessibility.md](accessibility.md).
- Ongoing: keep OpenSSF Baseline Level 1 and 2 met, earn the OpenSSF Best Practices Passing and then
  Silver badges, and keep the Scorecard score up.

## What Plex Director will not do

- **Find or fetch content on its own.** It works only through the services you have already set up
  (Radarr, Sonarr, Prowlarr, your download clients). It will not search indexers or trackers directly,
  scrape sites, add indexers, or source media in any other way.
- **Be a multi-user or multi-tenant system.** It is for one household with one shared password. It will
  not grow user accounts, per-user permissions or isolation between mutually untrusted users.
- **Mass-upgrade TV silently.** TV takes most of the storage; `plan_media_upgrade` refuses TV, and any
  bulk TV action will always be explicit, confirmed and rate-limited.
- **Act without a person asking.** Batch jobs never start on their own, the dashboard and its chat stay
  read-only for your services, and changes go through an MCP client that asks before each tool call.
- **Be a hosted service.** There is no cloud version and no account to sign up for. It runs on your own
  hardware, next to your media stack, and talks only to your services, TMDb, the Anthropic API and (if you
  set it) Discord.
- **Be exposed directly to the internet.** It is built for a trusted LAN. It will not grow its own TLS
  termination or public-facing hardening such as bot protection; use your own reverse proxy if you need
  remote access.
- **Show stored secrets.** API keys, tokens and passwords stay write-only; there will be no "reveal" button.
- **Replace the apps it talks to.** Quality profiles, indexers, download rules and library management stay
  in Radarr, Sonarr, Prowlarr, your download clients and Plex.
