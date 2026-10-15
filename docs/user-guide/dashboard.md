# The dashboard

The dashboard runs in the same process as the MCP server, at `http://<host>:3000` (or whatever port you
published). The sidebar on the left leads to each page; the page's name is at the top. Pages refresh by
themselves while they are open, so there is nothing to reload.

## Signing in

With `WEB_PASSWORD` set, the dashboard first asks for that password. A correct one keeps you signed in for 7 days
in that browser. **Sign out**, at the bottom of the sidebar, ends the session in this browser only. To sign out
every browser, change `WEB_PASSWORD` and restart the container.

After ten wrong passwords in 15 minutes, the sign-in page says to wait a few minutes before trying again.

Without `WEB_PASSWORD`, there is no sign-in, and an amber banner on every page warns that anyone who can reach the
dashboard can view and change its settings. See [installing.md](../installing.md#set-a-password).

## Query

A chat box for questions about your library. See [The Query chat](query-chat.md).

## Server Status

What Plex is doing, from **Tautulli**.

- **Plex Activity** (refreshed every 10 seconds): the number of streams playing now, split into direct play and
  transcoding, and for each stream the user, the title with its poster, the resolution, whether it is
  transcoding, and how far through it is.
- **Library Analytics** (every minute): Tautulli's home statistics, such as most watched movies and shows, most
  active users and platforms, with the top five in each and their play counts.

## Node Utilization

The health of each Linux host you list on the **Nodes** tab of Settings, read over SSH every 15 seconds:

| Column | What it shows |
| :--- | :--- |
| Host | The host's own name. |
| CPU, RAM | Current use, as a bar and a percentage (RAM also in MB). Bars turn amber at 70% and red at 90%. |
| Disk | Use of the root filesystem (`/`), as a percentage and size. |
| Uptime | Time since the host started, such as `2w 1d`. |
| Containers | Docker containers running, and a red count of stopped (exited or dead) ones. |
| Status | Online or Offline. An offline host shows why, such as a refused connection or a bad key. |

**When a host's SSH key changes**, Plex Director refuses to connect (someone could be pretending to be that
host), and the Status column says *SSH host key changed* with the key it now presents and a **Trust new key**
button. Only press it if you rebuilt or reinstalled that host: the browser asks you to confirm, Plex Director
forgets the old key, and the next check remembers the new one. Compare the fingerprint first
([installing.md](../installing.md#ssh-host-monitoring)).

No hosts configured? The page says so. Setting up host monitoring is in [installing.md](../installing.md#ssh-host-monitoring)
and [Hosts, backups and usage](hosts-and-monitoring.md).

## Queues

The download queues, refreshed every 10 seconds:

- **SABnzbd**: each file, its status, progress and time left.
- **qBittorrent**: each torrent that is downloading, its state, progress, speed and seeders. Torrents that
  qBittorrent reports as stalled are marked **stalled**.

The page only shows the queues. To remove stalled torrents, ask Claude
([Downloads and indexers](downloads-and-indexers.md#stalled-torrents-manage_stalled_downloads)).

## Indexers

Every indexer in **Prowlarr**, refreshed every 30 seconds, worst first:

| Status | Meaning |
| :--- | :--- |
| Backing off | Prowlarr has had failures and is waiting before it uses this indexer again; **Retry after** says until when. |
| Recent failures | Prowlarr has recorded failures, but isn't backing off now. |
| Disabled | Turned off in Prowlarr. |
| Healthy | No recorded problems. |

Each row also shows the protocol (Usenet or torrent), the priority and the last failure. Prowlarr's own health
warnings, if any, appear in an amber box at the top.

## Jobs

The 50 newest batch jobs, refreshed every 10 seconds: the job number, the task, its status (`PENDING`,
`RUNNING`, `PAUSED`, `COMPLETED` or `CANCELLED`), how many movies are done, and when it was created and last
updated. The page is read-only: you plan, start, pause and cancel jobs by asking Claude. See
[Batch jobs](jobs.md).

## Settings

One tab per service: **Sonarr**, **Radarr**, **Prowlarr**, **SABnzbd**, **qBittorrent**, **Tautulli**,
**Plex**, **TMDB** and **Nodes**, plus **UI**.

- Fill in the fields and click **Save** on each tab. The new values are used straight away by this process,
  the dashboard and its tools alike, without a restart. Another Plex Director process on the same data, such as
  a Claude Desktop container, picks up changed URLs and keys when it next starts, so restart Claude Desktop
  after changing them.
- **API keys, tokens and passwords are never shown again** once saved: the tab shows *configured* or *not set*
  next to the field. Leave the field blank to keep the stored value, or type a new one to replace it. A saved
  secret can't be cleared from this page.
- **Radarr** also has the default quality profile for movies you add (blank uses Radarr's first profile).
- **Plex** also has the libraries to leave out of searches unless you name them, such as `Sports`.
- **Nodes** has the hosts to monitor (comma-separated, with `:port` if SSH isn't on 22) and the SSH user. The
  private key itself is never entered here; it is a file given to the container ([installing.md](../installing.md#ssh-host-monitoring)).
- **UI → Appearance** picks Light, Dark, or System (follow your computer's setting). It is saved in this browser
  only.

What you save here overrides the matching environment variable for good. Which settings live where is in
[installing.md](../installing.md#settings).
