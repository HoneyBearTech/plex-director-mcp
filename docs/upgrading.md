# Upgrading, backups and restores

This assumes the Docker Compose setup from [installing.md](installing.md) (`compose.yaml` and `./data` in
`/opt/plex-director`). The Docker CLI and Claude Desktop work the same way; the differences are noted.

## What there is to keep

Everything Plex Director remembers is in one SQLite file in the data volume, `/app/data/plex_director.db`
(`./data/plex_director.db` on the host in the Compose example). The container itself holds nothing you need:
updating just replaces it.

| In the database | What it is |
| :--- | :--- |
| Settings | Every service URL and username, and **every API key, token and password** saved on the Settings page or seeded from the environment, stored as plain text. |
| Session secret | The random value that, with `WEB_PASSWORD`, signs login cookies. |
| Jobs | Batch jobs, the movies in each, and their progress. |
| SSH host keys | The fingerprint remembered for each monitored host. |
| Add-movie choices | The last TMDb grid, so a "grab choice 2" can follow it. |

Not in the database: `WEB_PASSWORD`, `ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL`, the SSH key and its
passphrase. Those live in your env file (and the key file), so back those up too, just as carefully.

> [!IMPORTANT]
> **A backup of `/app/data` is a copy of your credentials.** Anyone who has it can use your Radarr, Sonarr,
> Prowlarr, SABnzbd, qBittorrent, Tautulli, Plex and TMDb accounts. Keep backups readable only by you,
> encrypt them when they leave the machine, and delete old ones you no longer need.

## Back up

**Stop, copy, start** is the simplest way to get a consistent copy. Quit Claude Desktop too if it runs a
container on the same data.

```sh
cd /opt/plex-director
sudo docker compose stop
sudo tar czf plex-director-data-$(date +%F).tgz -C data .
sudo docker compose start
sudo chmod 600 plex-director-data-*.tgz
```

**Without stopping it**, if `sqlite3` is installed on the host, its `.backup` command makes a consistent copy
of the live database:

```sh
sudo sqlite3 data/plex_director.db ".backup 'plex_director-$(date +%F).db'"
sudo chmod 600 plex_director-*.db
```

**With a named volume** instead of a folder (for example `plex-director-data`, as in some Claude Desktop
setups), copy it out with a throwaway container while Plex Director is stopped:

```sh
docker run --rm -v plex-director-data:/data:ro -v "$PWD":/backup busybox \
  tar czf /backup/plex-director-data-$(date +%F).tgz -C /data .
```

To encrypt a backup before it goes anywhere else, for example with GnuPG:

```sh
gpg --symmetric --cipher-algo AES256 plex-director-data-2026-10-15.tgz   # writes ….tgz.gpg
```

The `run_cluster_backup` tool is something else: it asks Radarr, Sonarr and Prowlarr to back up *their own*
databases ([user guide](user-guide/hosts-and-monitoring.md#servarr-backups)). It doesn't back up Plex Director.

### If a backup leaks

Treat every credential in it as known to someone else: make a new API key in each app (Radarr, Sonarr,
Prowlarr and SABnzbd show a button for it next to the key), change the qBittorrent password, make a new
Tautulli API key and TMDb token, and revoke the Plex token by signing that device out in Plex. Enter the new
values on the Settings page. Change `WEB_PASSWORD` as well, which signs everyone out.

## Restore

Restore with Plex Director stopped (including any Claude Desktop container on the same data):

```sh
cd /opt/plex-director
sudo docker compose stop
sudo rm -f data/plex_director.db data/plex_director.db-journal
sudo tar xzf plex-director-data-2026-10-15.tgz -C data      # or: sudo cp plex_director-2026-10-15.db data/plex_director.db
sudo chown -R 65532:65532 data                              # the container's user (or the one you set with user:)
sudo docker compose start
```

Remove any leftover `plex_director.db-journal` before you put the old file back, as above: SQLite would
otherwise try to apply it to the restored database.

The restored database brings back the settings, jobs, remembered host keys and session secret. With the same
`WEB_PASSWORD`, browsers that were signed in when the backup was taken stay signed in.

**On a new machine**, install as in [installing.md](installing.md), but restore `data/` and your env file before
the first `docker compose up -d`. If you start it once without the backup, it creates a fresh database; stop it
and restore over that.

## Upgrade

1. **Read the release notes** for every version between yours and the new one, on the
   [Releases](https://github.com/HoneyBearTech/plex-director-mcp/releases) page and in the
   [changelog](../CHANGELOG.md). On `latest`, the changelog's *Unreleased* section says what has changed since
   the last release.
2. **[Verify](verifying-releases.md)** the new image, and **[back up](#back-up)**.
3. **Change the tag** in `compose.yaml` if you pin one: to the new version, `sha-` tag or digest. With `latest`,
   leave it as it is.
4. **Pull and restart:**

   ```sh
   cd /opt/plex-director
   sudo docker compose pull
   sudo docker compose up -d
   sudo docker compose ps            # wait for "healthy"
   sudo docker image prune           # optional: removes the old image
   ```

A job that was running carries on where it stopped: progress is saved after every movie.

### Upgrading to 1.3.0: the container no longer runs as root

From 1.3.0 the image runs as UID and GID 65532 instead of root. Data written by an earlier version belongs to
root, so give it to the new user once, with Plex Director stopped (including any Claude Desktop container on
the same data). Without this the container stops at start-up and prints the same advice.

- **A host folder** (the Compose example's `./data`):

  ```sh
  cd /opt/plex-director
  sudo docker compose stop
  sudo chown -R 65532:65532 data
  sudo docker compose up -d
  ```

- **A named volume** (for example `plex-director-data`), with a throwaway container since the image has no
  `chown` of its own:

  ```sh
  docker run --rm -v plex-director-data:/data busybox chown -R 65532:65532 /data
  ```

- **Or keep the old owner:** set `user:` (or `--user`) to the UID that owns the data, for example
  `user: "1000:1000"` if you already ran it that way, or `user: "0:0"` to stay root (not recommended).

The same applies to a database you copy into a volume by hand (`docker cp` writes files as root): `chown` it
as above afterwards. Rolling back to 1.2.x after the `chown` works without changes, since that image runs as
root.

**Docker CLI:** `docker pull` the new tag, `docker stop plex-director && docker rm plex-director`, then run the
same `docker run` command with the new tag.

**Claude Desktop:** change the tag in `claude_desktop_config.json`, then `docker pull` it and restart Claude
Desktop. If you use `latest`, `docker run` doesn't check for a newer image by itself; run
`docker pull honeybeartech/plex-director-mcp:latest` to update.

**From source:** `git fetch --tags && git checkout v<new version>`, then `npm install` and
`(cd web && npm install && npm run build)`, and restart.

## Pinning a version

- `latest` follows the `main` branch, so it can change at any time and includes changes that have no release
  yet. Pin a release (1.2.0 or later) to choose when you upgrade.
- A `sha-` tag, such as `sha-d2bca8a`, is one build of `main` and stays on it. Pin one to keep the `latest`
  build you have tried, and move it on when you choose.
- A version tag such as `1.3.0` stays on that release. `1.3` moves to each new 1.3.x patch release.
- A digest (`honeybeartech/plex-director-mcp@sha256:…`, optionally with the tag in front) can't be moved at
  all, not even by someone who could push to the registry. [verifying-releases.md](verifying-releases.md#pin-the-digest)
  shows how to find and check it.

Releases follow [semantic versioning](https://semver.org/): a patch release only fixes things, a minor release
adds features without breaking existing setups, and a major release can need you to change something.

## Roll back

Set the tag back to the version you had and run `docker compose up -d` again.

So far, no release has changed the database in a way an older version can't read: each version only creates
the tables it needs if they are missing, and settings are simple name and value pairs, so an older version
ignores what it doesn't know. That may not stay true forever. If a release changes it, its notes should say
so, and the backup you took before upgrading is your way back: restore it with the old tag.

Rolling back also takes away whatever the newer build added. In particular, never roll back below 1.2.0:
1.1.0 ignores `WEB_PASSWORD` and leaves the dashboard open. Roll back to an earlier 1.2.x release or `sha-`
tag instead.
