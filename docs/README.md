# Plex Director documentation

> [!WARNING]
> **Some tools change things, and there is no undo.** Plex Director holds the API keys for every service
> you connect. Adding movies (`confirm_selected_choices`) adds them to Radarr and starts download searches;
> `manage_stalled_downloads` with `PURGE_STALLED` deletes the torrents you agreed to, after an `AUDIT`,
> **and their files** from qBittorrent; a started batch job sends one Radarr search per minute until it finishes; and
> `run_cluster_backup` starts the Radarr, Sonarr and Prowlarr backups. Claude Desktop asks before it uses a
> tool, so read what it proposes.
>
> **Set a password and keep it off the internet.** Without `WEB_PASSWORD`, anyone who can reach the
> dashboard can read your library and change every saved service setting. Plex Director is built for a
> home LAN, not the public internet ([installing.md](installing.md#running-it-securely)).
>
> **The data volume holds your credentials.** Back it up, and treat the backups like a password store
> ([upgrading.md](upgrading.md#back-up)).

## Getting started

- [Quick start](quick-start.md): the fastest way to a running dashboard, and to Plex Director in Claude
  Desktop.
- [Installing](installing.md): Docker Compose, the Docker CLI, Claude Desktop and running from source, with
  every setting, volume and port, and how to run it securely.
- [Upgrading, backups and restores](upgrading.md): moving to a new version, pinning one, backing up and
  restoring `/app/data`, and rolling back.
- [Verifying releases](verifying-releases.md): checking the image signatures with cosign, and pinning
  digests.

## Using Plex Director

The [user guide](user-guide/README.md) covers the dashboard and the MCP tools:

- [The dashboard](user-guide/dashboard.md): signing in, Server Status, Node Utilization, Queues, Indexers,
  Jobs and Settings.
- [The Query chat](user-guide/query-chat.md): asking questions about your library in the browser.
- [Your library](user-guide/library.md): searching what you own in Plex, finding episodes, On Deck, and
  actor filmographies.
- [Movies](user-guide/movies.md): checking a movie in Radarr, working out why it is missing, and adding
  movies.
- [TV shows](user-guide/tv.md): missing episodes, gaps across your shows, quality, status, and what airs
  next.
- [Downloads and indexers](user-guide/downloads-and-indexers.md): the download queues, stalled torrents,
  and Prowlarr indexer health.
- [Batch jobs](user-guide/jobs.md): planning, starting, pausing and following a movie-upgrade batch.
- [Hosts, backups and usage](user-guide/hosts-and-monitoring.md): SSH host monitoring, Servarr backups, and
  Plex streams and watch statistics from Tautulli.

The main [README](../README.md) also lists every environment variable and every MCP tool in one place.

## About the project

- [Architecture](architecture.md), [external interfaces](interfaces.md) (with the
  [OpenAPI description](api/openapi.json) of the dashboard's HTTP API), [security requirements](security.md),
  the [assurance case](assurance-case.md) and [accessibility](accessibility.md).
- [Dependencies and vulnerability management](dependencies.md): how dependencies are chosen and kept up to
  date, and how vulnerability reports and scan findings are handled.
- [Roadmap](roadmap.md), [changelog](../CHANGELOG.md), [support](../SUPPORT.md),
  [governance](../GOVERNANCE.md), [contributing](../CONTRIBUTING.md),
  [code of conduct](../CODE_OF_CONDUCT.md) and [reporting a vulnerability](../SECURITY.md).
