# Downloads and indexers

## The download queues

The dashboard's **Queues** page shows the SABnzbd and qBittorrent queues, refreshed every 10 seconds
([The dashboard](dashboard.md#queues)). In Claude Desktop, `manage_stalled_downloads` with `AUDIT` lists the
torrents that are stuck.

## Stalled torrents: `manage_stalled_downloads`

Works on the torrents qBittorrent is downloading. A torrent counts as **stalled** when qBittorrent reports it as
stalled, or when it is downloading but slower than a minimum speed: 50 KB/s unless you give another ("anything
under 100 KB/s").

It has two actions:

- **`AUDIT`** lists the stalled torrents, with each one's speed, progress and seeders. It changes nothing. Ask
  "Which torrents are stalled?"
- **`PURGE_STALLED`** **deletes** every stalled torrent from qBittorrent, **together with its downloaded files**,
  straight away. Ask "Clean up stalled torrents."

> [!CAUTION]
> `PURGE_STALLED` can't be undone, and it removes every torrent that counts as stalled at that moment, not a
> list you pick. Run `AUDIT` first and read the list. Claude Desktop asks before it runs the tool; check that the
> action it proposes is the one you want.

The reply to `PURGE_STALLED` says the releases were "blocklisted", but Plex Director doesn't tell Radarr or
Sonarr anything: it only deletes the torrents in qBittorrent. Whether Radarr or Sonarr then search for another
release, or try the same one again, depends on their own settings.

## Indexer health: `check_indexer_health`

"Are any of my indexers failing?" Asks **Prowlarr** about every indexer and tracker, and reports:

- indexers that are **backing off** (Prowlarr has paused them after failures), with when they will be tried
  again;
- indexers with **recent failures** that aren't backed off;
- indexers that are **disabled** in Prowlarr;
- Prowlarr's own health warnings.

If none has problems, it says how many enabled indexers are healthy. It only reads. The dashboard's
**Indexers** page shows the same information as a table ([The dashboard](dashboard.md#indexers)).
