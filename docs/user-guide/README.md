# User guide

Plex Director connects to your Plex and Servarr apps and lets you work with them in two ways: from **Claude
Desktop**, which uses Plex Director's 25 MCP tools, and from the **web dashboard** in your browser. This guide
walks through both. If you haven't installed it yet, start with the [quick start](../quick-start.md).

> [!WARNING]
> Some tools change things, and there is no undo. See the warning in the
> [documentation index](../README.md).

## Two ways in

| | Claude Desktop | Web dashboard |
| :--- | :--- | :--- |
| How you use it | Ask Claude in a chat; it picks the tools. | Pages that refresh by themselves, plus the **Query** chat. |
| What it can do | All 26 tools, including adding movies, cleaning up stalled torrents, batch jobs and backups. | Look at everything; change the service settings. The Query chat only uses the 12 read-only library, movie and TV tools. |
| What it needs | Claude Desktop, and Plex Director in its config ([installing.md](../installing.md#option-3-claude-desktop)). | A browser on your network. The Query chat also needs `ANTHROPIC_API_KEY`. |
| Asks before acting | Claude Desktop asks your permission before each tool use. | The only action buttons are **Save** (Settings) and **Trust new key** (which asks first, and needs `WEB_PASSWORD`). |

Both run the same code for each tool, so a tool finds the same results whichever way you ask.

## The pages

- [The dashboard](dashboard.md): signing in, and each page: Server Status, Node Utilization, Queues,
  Indexers, Jobs and Settings.
- [The Query chat](query-chat.md): asking questions about your library in the browser, follow-ups, and the
  results table.
- [Your library](library.md): searching Plex for movies and shows, finding episodes, On Deck, and which of
  an actor's titles you own.
- [Movies](movies.md): a movie's state in Radarr, working out why it is missing, and adding movies.
- [TV shows](tv.md): missing episodes and why, shows with gaps, quality, a show's status, and what airs next.
- [Downloads and indexers](downloads-and-indexers.md): the SABnzbd and qBittorrent queues, stalled torrents,
  and Prowlarr indexer health.
- [Batch jobs](jobs.md): planning a movie-upgrade batch, starting, pausing and cancelling it, and how the job
  runner paces it.
- [Hosts, backups and usage](hosts-and-monitoring.md): CPU, memory, disk and containers on your Linux hosts,
  Servarr backups, and Plex streams and watch statistics from Tautulli.

## Which service each part needs

You only need to connect the services you use. A tool or page whose service isn't set up shows an error
instead (the Plex tools say plainly that Plex isn't configured; others show the connection error), and the
rest keep working.

| Service | Used for |
| :--- | :--- |
| Plex | Library search, episodes, On Deck, ownership in filmographies, posters in the Query chat. |
| Radarr | Movie status and diagnosis, adding movies, batch jobs, backups. |
| Sonarr | Everything under [TV shows](tv.md), backups. |
| TMDb | Actor filmographies, the add-movie grid. |
| SABnzbd, qBittorrent | The **Queues** page, stalled torrents, diagnosing missing movies. |
| Prowlarr | The **Indexers** page and indexer health, backups. |
| Tautulli | The **Server Status** page, streams and watch statistics. |
| SSH | The **Node Utilization** page and host health. |
| Discord | Optional messages when a batch job completes or is paused. |

## Asking well

Tool names don't matter in Claude Desktop: ask in plain words and Claude picks the tool. Some examples that work
well:

- "Which of Harrison Ford's movies do I have in 4K?"
- "What should I watch next?" or "What's on this week?"
- "Do I have every episode of Bluey? Why is season 2 episode 5 missing?"
- "Which shows do I only have in 720p?"
- "Why is Heat missing?" then "Add Heat (1995)."
- "Are any of my indexers failing?" or "Clean up stalled torrents."
- "Plan an upgrade of movies below 1080p", then "Start job 3."

Watch state (watched, in progress, On Deck) is that of the Plex account whose token Plex Director uses.
