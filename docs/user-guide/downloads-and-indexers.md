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

- **`AUDIT`** lists the stalled torrents, with each one's speed, progress, seeders and hash. It changes
  nothing. Ask "Which torrents are stalled?"
- **`PURGE_STALLED`** **deletes** torrents from qBittorrent, **together with their downloaded files**, but only
  the ones named by hash from an `AUDIT`. Ask "Clean up stalled torrents": Claude runs `AUDIT`, shows you the
  list, and after you agree (to all of them, or say which) calls `PURGE_STALLED` with just those hashes.

A named torrent is left alone if it has finished or gone, or is downloading at a normal speed again by then;
the reply says which were deleted and which weren't. Without hashes, `PURGE_STALLED` deletes nothing.

> [!CAUTION]
> `PURGE_STALLED` can't be undone. Claude Desktop asks before it runs the tool: check that the torrents it is
> about to delete are the ones you agreed to.

`PURGE_STALLED` only deletes the torrents, and their files, in qBittorrent. It doesn't tell Radarr or Sonarr
anything, so nothing is blocklisted, and the reply says so: whether they then search for another release, or
grab the same one again, depends on their own settings. To keep a bad release from coming back, remove it from
Radarr's or Sonarr's queue with their blocklist option instead.

## Indexer health: `check_indexer_health`

"Are any of my indexers failing?" Asks **Prowlarr** about every indexer and tracker, and reports:

- indexers that are **backing off** (Prowlarr has paused them after failures), with when they will be tried
  again;
- indexers with **recent failures** that aren't backed off;
- indexers that are **disabled** in Prowlarr;
- Prowlarr's own health warnings.

If none has problems, it says how many enabled indexers are healthy. It only reads. The dashboard's
**Indexers** page shows the same information as a table ([The dashboard](dashboard.md#indexers)).
