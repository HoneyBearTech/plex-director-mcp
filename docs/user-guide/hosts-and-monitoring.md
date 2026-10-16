# Hosts, backups and usage

## Host monitoring over SSH

Plex Director can log in to your Linux hosts over SSH and read their CPU, memory, disk, uptime and Docker
containers. You see the result on the dashboard's **Node Utilization** page
([The dashboard](dashboard.md#node-utilization)) and through two tools in Claude Desktop.

### Setting it up

1. Make an SSH key for Plex Director, and a dedicated, unprivileged user on each host that accepts it.
2. Give the private key to the container as a read-only file and set `SSH_KEY_PATH` (and `SSH_KEY_PASSPHRASE`
   if the key has one). See [installing.md](../installing.md#ssh-host-monitoring) for the mount and the
   permissions.
3. On the **Nodes** tab of Settings, list the hosts, comma-separated (`192.168.1.10,192.168.1.11`, with
   `:2222` after a host whose SSH isn't on port 22), and the SSH user.

Each check opens one SSH connection per host and runs only read-only commands: `hostname`, `top`, `free`,
`df -h /`, `docker ps` and `/proc/uptime`. Container counts need the user to be allowed to run `docker ps`; see
[installing.md](../installing.md#ssh-host-monitoring) for what that means.

### Host keys

The first time Plex Director connects to a host, it remembers the host's key. After that, a host that presents a
different key is refused before any command runs, and it shows as offline with *SSH host key changed*. If you
rebuilt or reinstalled it, use **Trust new key** on the Node Utilization page (shown when `WEB_PASSWORD` is set),
or ask Claude Desktop to run `trust_new_host_key` for that host. If you didn't, don't: someone may
be pretending to be that host.

### The tools

- **`get_cluster_infrastructure_health`**: "How are my hosts doing?" Per host: CPU, memory (percentage and MB),
  running containers, and the names of any stopped ones. Offline hosts show why.
- **`get_cluster_hardware_analytics`**: CPU and memory per host, as a short table.
- **`trust_new_host_key`**: "I rebuilt atlas, trust its new key." Forgets the remembered key of a configured
  host, so the next check remembers the one it presents now: the same as the dashboard's **Trust new key**,
  which is only offered when `WEB_PASSWORD` is set. Compare the fingerprint first.

## Servarr backups

**`run_cluster_backup`**: "Back up my Servarr apps." Asks Radarr, Sonarr and Prowlarr (whichever are set up) to
run their **own built-in backup**, all at once, and waits up to about a minute for each. For each app, the reply
says:

- the new backup file's name, size and time, once the app lists a file newer than the request; or
- that the backup was started but is still running (large databases can take longer than a minute; it will
  usually finish on its own, and the app's *System → Backup* page shows it); or
- that it failed, with the reason, or was skipped because the app isn't set up.

The backups stay in each app's own backup folder on its own host. Plex Director doesn't copy or download them,
and this doesn't back up Plex Director itself: for that, see [upgrading.md](../upgrading.md#back-up).

Claude Desktop asks before running it. Starting a backup doesn't change your media, but it does make each app
do the work straight away.

## Plex usage, from Tautulli

- **`get_plex_activity`**: "What's playing on Plex?" The streams playing now, who is watching what, and how many
  are transcoding (the load on your server), or that Plex is idle.
- **`get_library_analytics`**: "What's been watched most?" Tautulli's statistics: most watched titles, most
  active users, platforms and libraries.

The dashboard's **Server Status** page shows the same, refreshed by itself
([The dashboard](dashboard.md#server-status)).

## Notifications

With `DISCORD_WEBHOOK_URL` set, Plex Director posts to Discord when a batch job completes and when one is paused
after repeated failures ([Batch jobs](jobs.md)). There are no other notifications, and no other channels.
