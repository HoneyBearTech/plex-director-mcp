# Installing

This runs a released version of Plex Director from the published container image, on a machine on your home
network next to the apps it talks to. For a first try in a few minutes, see [quick-start.md](quick-start.md).

Plex Director is built for a trusted home network. It is not designed or tested to be exposed to the public
internet: see [Running it securely](#running-it-securely) below and [security.md](security.md).

## How it runs

One Node.js process does three things at once:

- an **MCP server** that talks to Claude Desktop over stdin/stdout (26 tools);
- a **web dashboard** and its HTTP API on port `3000` (`WEB_PORT`), with a health check at `GET /healthz`;
- a **job runner** that advances started batch jobs, one Radarr search per minute.

Everything it remembers (service settings including their API keys, job history, remembered SSH host keys and
the login-session secret) is in one SQLite database, `/app/data/plex_director.db` in the container.

There are two common setups, and you can use both together:

1. A long-running container for the **dashboard** (Docker Compose or the Docker CLI).
2. **Claude Desktop** starting its own short-lived container with `docker run -i` whenever it opens.

Give both the same data folder or volume so they share settings and jobs. Two processes using the same
database is supported: a job step is claimed in the database before it runs, so no movie is searched twice.

## What you need

- Docker Engine, with Docker Compose v2 for the Compose setup. The image is published for `linux/amd64` and
  `linux/arm64`; Docker picks the right one.
- Network access from that machine to each service you connect (Plex, Radarr, Sonarr, Prowlarr, SABnzbd,
  qBittorrent, Tautulli) and, for actor filmographies and adding movies, to TMDb on the internet.
- Optional: an [Anthropic API key](https://console.anthropic.com/) for the Query chat, a Discord webhook for
  job notifications, and an SSH key for host monitoring.

## Choose an image and a tag

The image is published to two registries. Both get the same build, with the same digest, and both are
signed ([verifying-releases.md](verifying-releases.md)):

| Registry | Image |
| :--- | :--- |
| Docker Hub | `honeybeartech/plex-director-mcp` |
| GitHub Container Registry | `ghcr.io/honeybeartech/plex-director-mcp` |

| Tag | What it is |
| :--- | :--- |
| `latest` | The newest build of the `main` branch, **including changes that are not in a release yet**. |
| `sha-<commit>` | The build of one commit of `main`, such as `sha-d2bca8a`. It never changes. |
| `1.4.0` | One release. Pin a release to choose when you upgrade. |
| `1.4` | The newest patch release of 1.4. |

> [!IMPORTANT]
> **Use 1.2.0 or later.** These docs describe 1.4.0. Upgrading from 1.2.x or 1.3.x, read
> [upgrading](upgrading.md#upgrade) first: 1.3.0 runs as a non-root user, and 1.4.0 changes proxy and host-key handling. Releases before 1.2.0 are much older: 1.1.0 has **no
> dashboard password** (`WEB_PASSWORD` is ignored), no health check, no Plex or TV tools, no Indexers or Jobs
> pages and no job runner. See the [changelog](../CHANGELOG.md).

The examples use `latest`. To pin the build you are running instead, use its `sha-` tag, or for the strongest
pin its digest ([verifying-releases.md](verifying-releases.md#pin-the-digest)).

## Option 1: Docker Compose (recommended)

Make a directory, for example `/opt/plex-director`, and put the settings that are secrets in a file of their
own, `plex-director.env`, so they stay out of `compose.yaml`:

```sh
sudo mkdir -p /opt/plex-director/data && cd /opt/plex-director
sudo touch plex-director.env && sudo chmod 600 plex-director.env
```

`plex-director.env` (only the lines you need; see [Settings](#settings) for every variable):

```env
WEB_PASSWORD=a-long-password
ANTHROPIC_API_KEY=sk-ant-your-key
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Docker reads this file literally: no quotes around values, and comments only on their own line
(`KEY=abc # note` makes `abc # note` the value). The repository's
[`.env.example`](../.env.example) lists every variable with a comment, and can be copied as a starting point.

`compose.yaml`:

```yaml
services:
  plex-director:
    image: honeybeartech/plex-director-mcp:latest
    container_name: plex-director
    env_file:
      - plex-director.env
    volumes:
      - ./data:/app/data
      # - /home/you/.ssh/plex_director_ed25519:/ssh/id_ed25519:ro   # optional, host monitoring
    ports:
      - 3000:3000
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
```

The `read_only`, `cap_drop` and `security_opt` lines are optional but recommended
([below](#run-as-a-non-root-user-with-a-read-only-filesystem)). The container runs as UID 65532, not root, so
the data directory must belong to that user first:

```sh
sudo chown -R 65532:65532 data
sudo docker compose up -d
sudo docker compose ps
```

The image has its own health check, so `docker compose ps` shows `healthy` once it is up. Then open
`http://<host>:3000`, sign in, and fill in **Settings**.

## Option 2: Docker CLI

```sh
docker run -d \
  --name=plex-director \
  --env-file /opt/plex-director/plex-director.env \
  -p 3000:3000 \
  -v /opt/plex-director/data:/app/data \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --restart unless-stopped \
  honeybeartech/plex-director-mcp:latest
```

As with Compose, `sudo chown -R 65532:65532 /opt/plex-director/data` first. Add more variables with more
`-e NAME=value` flags or lines in the env file. For host monitoring, add
`-v /home/you/.ssh/plex_director_ed25519:/ssh/id_ed25519:ro` and `SSH_KEY_PATH=/ssh/id_ed25519`.

## Option 3: Claude Desktop

The image is also the MCP server. Claude Desktop starts it with `docker run -i` and talks to it over stdin and
stdout. Open **Settings → Developer → Edit Config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "plex-director": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/absolute/path/to/plex-director.env",
        "-v", "/absolute/path/to/plex-director/data:/app/data",
        "honeybeartech/plex-director-mcp:latest"
      ]
    }
  }
}
```

Restart Claude Desktop, and the `plex-director` server appears with its 26 tools.

- `-i` is required, since MCP talks over stdin/stdout. Don't add `-t`.
- No `-p` is needed. The dashboard also starts inside this container, but it stays unreachable unless you
  publish its port.
- Use the same data folder (or named volume, such as `-v plex-director-data:/app/data`) as your dashboard
  container, so both see the same settings and jobs. Without a dashboard, put the service settings in the env
  file instead ([Settings](#settings)).
- You can add `--read-only`, `--cap-drop ALL` and `--security-opt no-new-privileges:true` here too. Both
  containers run as UID 65532, so they can share the database; if you gave the dashboard another `user:`,
  give this container the same `--user`.
- If Claude Desktop can't find `docker`, give its full path in `command` (see `which docker`).
- Quitting Claude Desktop stops the container; `--rm` removes it.

## Option 4: From source

This runs the TypeScript directly with Node.js, for Claude Desktop without Docker or for development. You need
Node.js 24 and Git.

```sh
git clone https://github.com/HoneyBearTech/plex-director-mcp.git
cd plex-director-mcp
# main is what these docs describe; for the release instead: git checkout v1.4.0
npm install
(cd web && npm install && npm run build)   # builds the dashboard; without it the web pages don't load
```

Copy `.env.example` to `.env` in the repository root (`.env` is ignored by git) and fill in what you use; the
variables are the same as [below](#settings). Values with spaces need quotes around the whole value:
`SSH_KEY_PATH="/Users/me/.ssh/my key"`. Comments go on their own line. Restrict the file to your own user:
`chmod 600 .env`.

Then either start it yourself with `npm start` (MCP on stdio, dashboard on `WEB_PORT`), or add it to Claude
Desktop:

```json
{
  "mcpServers": {
    "plex-director": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/plex-director-mcp/src/index.ts"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
```

The process also starts the dashboard on `WEB_PORT` (default `3000`). If another program, such as a dashboard
container, already uses that port on this machine, set a different `WEB_PORT` in `.env`.

The database is then `data/plex_director.db` in the repository. Never commit `.env` or `data/`.

## Settings

Nothing is required to start: Plex Director boots with no configuration, and you fill things in on the
**Settings** page.

### Ports and volumes

| Parameter | What it is for |
| :--- | :--- |
| `-p 3000:3000` | The dashboard. The left number is the port on your host; see [Exposure](#keep-the-port-off-the-internet) for binding it to one address. |
| `-v <path>:/app/data` | The SQLite database. **Mount a volume or folder here**, or every setting and job is lost when the container is recreated. It must be writable by the container's user. |
| `-v <key>:/ssh/id_ed25519:ro` | *Optional.* A private SSH key for host monitoring, mounted read-only, with `SSH_KEY_PATH=/ssh/id_ed25519`. |

### Container settings

These are read from the environment every time the process starts. They are never stored in the database or
shown on the Settings page.

| Variable | Default | What it does |
| :--- | :---: | :--- |
| `WEB_PASSWORD` | *(none)* | Requires a sign-in for the dashboard. **Strongly recommended.** Changing it signs everyone out. |
| `WEB_ALLOWED_HOSTS` | *(none)* | Only used without `WEB_PASSWORD`. Extra host names the dashboard answers to, comma-separated, for example the public name a reverse proxy serves it on. IP addresses, `localhost`, single-word names and `.local`, `.lan`, `.home.arpa` and `.internal` names always work; any other name gets a 403 explaining this, which stops DNS-rebinding pages from reaching an open dashboard. `*` turns the check off. |
| `WEB_TRUST_PROXY` | *(none)* | Set it when a reverse proxy sits in front: the proxy's address or subnet, comma-separated, or `loopback` for one on the same host. Only requests from there may set `X-Forwarded-For` and `X-Forwarded-Proto` ([below](#keep-the-port-off-the-internet)). Unset, both are ignored. |
| `SETTINGS_ENCRYPTION_KEY` | *(none)* | Encrypts the service credentials saved in the database (AES-256-GCM). 32 random bytes, base64 or hex: make one with `openssl rand -base64 32`. Credentials already saved are encrypted at the next start. Every container sharing the database needs the same key, and the database is useless without it, so keep a copy somewhere other than your backups. **Recommended**; see [Encrypt the saved credentials](#encrypt-the-saved-credentials). |
| `WEB_PORT` | `3000` | The port the dashboard listens on inside the container. |
| `ANTHROPIC_API_KEY` | *(none)* | Turns on the Query chat. A pay-per-use Anthropic API key. |
| `SSH_KEY_PATH` | *(none)* | Path inside the container to the private key for host monitoring. |
| `SSH_KEY_PASSPHRASE` | *(none)* | The key's passphrase, if it has one. |
| `DISCORD_WEBHOOK_URL` | *(none)* | Discord webhook for "job completed" and "job paused" messages. |
| `JOB_RUNNER_INTERVAL_SECONDS` | `60` | How often the job runner advances a started job by one movie. Minimum `10`; `0` turns the runner off. |

### Service connections

These are the fields of the Settings page. On the very first start, any that are set in the environment are
copied into the database. **From then on the database wins**: changing the variable later does nothing. Change
the value on the Settings page instead.

| Variable | Settings tab | What it is for |
| :--- | :--- | :--- |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr | Movie status, diagnosis, adding movies, batch jobs, backups. |
| `RADARR_DEFAULT_QUALITY_PROFILE` | Radarr | *Optional.* The quality profile new movies get. Blank uses Radarr's first profile. |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr | TV completeness, gaps, quality, status, calendar, backups. |
| `PROWLARR_URL`, `PROWLARR_API_KEY` | Prowlarr | Indexer health and backups. |
| `SABNZBD_URL`, `SABNZBD_API_KEY` | SABnzbd | The Usenet queue, and diagnosing missing movies. |
| `QBITTORRENT_URL`, `QBITTORRENT_USER`, `QBITTORRENT_PASS` | qBittorrent | The torrent queue and stalled-download cleanup. |
| `TAUTULLI_URL`, `TAUTULLI_API_KEY` | Tautulli | Live streams and watch statistics. The URL without `/api/v2`. |
| `PLEX_URL`, `PLEX_TOKEN` | Plex | Searching what you own, episodes, On Deck. |
| `PLEX_SKIP_LIBRARIES` | Plex | *Optional.* Comma-separated library names to leave out of searches unless named, such as `Sports`. |
| `TMDB_API_KEY` | TMDB | The TMDb **API Read Access Token**: actor filmographies and the add-movie grid. |
| `UBUNTU_HOSTS` | Nodes | Comma-separated hosts to monitor over SSH, with `:port` for a non-standard port (`192.168.1.10:2222`). |
| `SSH_USER` | Nodes | The SSH user on those hosts. |

On the Settings page, a saved API key, token or password is never shown again, only whether it is set.
Leaving a secret field blank and saving keeps the stored value.

### Where to find each credential

| Service | What to enter |
| :--- | :--- |
| Radarr, Sonarr, Prowlarr | The URL, and the API key from *Settings → General*. |
| SABnzbd | The URL, and the API key from *Config → General*. |
| qBittorrent | The Web UI URL, username and password. |
| Tautulli | The URL, and the API key from *Settings → Web Interface*. |
| Plex | The server URL (such as `http://192.168.1.10:32400`) and an X-Plex-Token: open any movie in Plex Web, choose **⋯ → Get Info → View XML**, and copy the `X-Plex-Token=` value from the address bar. Treat it like a password. |
| TMDb | The **API Read Access Token** (the long one) from your TMDb account's API settings, not the short v3 API key. |

Inside a container, `localhost` is the container itself. Use each service's LAN address
(`http://192.168.1.10:7878`) or, on a shared Docker network, its service name (`http://radarr:7878`).

## Running it securely

### Set a password

Set `WEB_PASSWORD`. Without it the dashboard, including the Settings page that changes every service
connection, is open to anyone who can reach the port. The server logs a warning at start-up and the dashboard
shows a banner until you set one.

With a password, signing in gives a 7-day session cookie that scripts in the page can't read and other sites
can't send. Ten failed sign-ins within 15 minutes block further attempts for a while. Signing out only clears
the cookie in that browser: to sign everyone out, change `WEB_PASSWORD` and restart. It is a single shared
password; there are no separate users.

### Keep the port off the internet

- Don't forward the port from your router, and don't publish it on a server that has a public address.
- If only this machine needs the dashboard, or a reverse proxy runs on the same host, publish it on loopback
  only: `127.0.0.1:3000:3000` in Compose, or `-p 127.0.0.1:3000:3000`.
- The dashboard speaks plain HTTP. To reach it from outside your LAN, use a VPN, or a reverse proxy you trust
  that adds HTTPS and some sign-in of its own.
- **Behind a reverse proxy, set `WEB_TRUST_PROXY`** to the proxy's address as the container sees it (or its
  subnet; `loopback` when it runs on the same host). Plex Director then takes the client's address from
  `X-Forwarded-For`, so the sign-in limit counts each client instead of the proxy as one, and marks the
  session cookie `Secure` when the proxy says, in `X-Forwarded-Proto`, that the visit was HTTPS. Without it,
  those headers are ignored, which keeps anyone who reaches the port directly from faking them. Nginx Proxy
  Manager and [Caddy](https://caddyserver.com/) send both headers already; with Caddy:

  ```caddyfile
  plex-director.example.com {
      reverse_proxy 127.0.0.1:3000
  }
  ```

  With plain nginx, add `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and
  `proxy_set_header X-Forwarded-Proto $scheme;` to the `location` block.

### Run as a non-root user, with a read-only filesystem

From 1.3.0 the container runs as UID and GID 65532 (distroless's `nonroot` user), not root. The image is
distroless (no shell or package manager), and `/app/data` is the only place it writes, so it also runs
read-only with no capabilities, as in the Compose example above. The data directory must be writable by the
container's user: `chown -R 65532:65532 data` for a host folder, while a new named volume already is. To run
as a different user, for example one that owns an existing folder, set `user:` (or `--user`). If the folder
isn't writable, the container stops at start-up and prints the command that fixes it. Coming from 1.2.x or
earlier, see [upgrading](upgrading.md#upgrading-to-130-the-container-no-longer-runs-as-root).

### Keep secrets out of files others can read

- Keep `WEB_PASSWORD`, `ANTHROPIC_API_KEY` and the webhook in an env file readable only by you (`chmod 600`),
  not in `compose.yaml`, which tends to get shared or committed.
- Service API keys typed into the Settings page are stored in the database, **as plain text unless you set
  `SETTINGS_ENCRYPTION_KEY`** ([below](#encrypt-the-saved-credentials)). Restrict the data directory
  (`chmod 700 data`) and treat backups of it as secrets ([upgrading.md](upgrading.md#back-up)).

### Encrypt the saved credentials

With `SETTINGS_ENCRYPTION_KEY` set, the API keys, tokens and passwords in the database are encrypted
(AES-256-GCM, each tied to its setting), so a copy of the data folder, a stray backup included, doesn't give
them away. URLs, usernames and the rest stay readable.

```sh
openssl rand -base64 32        # put the result in plex-director.env as SETTINGS_ENCRYPTION_KEY=...
```

- Credentials saved earlier are encrypted the next time Plex Director starts; the log says how many.
- **Every container using the same data needs the same key**, the Claude Desktop one included. The examples
  here pass the same env file to both (`env_file:` and `--env-file`), so putting the key in it covers both.
- **Keep the key safe, and apart from your backups.** Without it the saved credentials can't be read: Plex
  Director stops at start-up and says so, rather than running with every service blank. If the key is lost,
  start once with `SETTINGS_ENCRYPTION_RESET=1` to delete the unreadable credentials, enter them again on the
  Settings page, and remove `SETTINGS_ENCRYPTION_RESET`.
- There is no way back to plain text, and no key rotation yet: to change the key, reset as above and enter the
  credentials again.
- Not encrypted: the session-signing secret (on its own it is only a salt; signing also needs
  `WEB_PASSWORD`) and everything that isn't a credential.
- Never build secrets into an image; pass them when the container starts.

### SSH host monitoring

- Use a key made for Plex Director, and a dedicated, unprivileged user on each host. Plex Director only runs
  read-only commands (`hostname`, `top`, `free`, `df`, `docker ps`, `/proc/uptime`), but it can log in as that
  user, so anything the user can do, a stolen key can do.
- Container counts come from `docker ps`, which normally needs the user to be in the `docker` group. On most
  systems that group is as good as root on that host. If you'd rather not give it, leave the user out of the
  group: the containers column then shows 0.
- Mount the key read-only (`:ro`), as a single file, and make sure the container's user can read it
  (`sudo chown 65532:65532` the key file on the host, or the UID you set with `user:`).
- Each host's key is remembered the first time it connects, and a different key is refused after that. That
  protects against a host being swapped *after* first contact, not during the first connection itself, so add
  hosts while you are on a network you trust. When the **Node Utilization** page reports a changed key, it
  shows the new fingerprint: before you click **Trust new key** (only offered when `WEB_PASSWORD` is set) or
  run `trust_new_host_key` in Claude Desktop, compare it with the one the host itself
  reports (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the host).

### Review what Claude does

The Query chat and Claude Desktop act with your keys. The chat only uses the read-only library, movie and TV
tools. Claude Desktop has all 26, including the ones that add movies, delete stalled torrents, change jobs and
start backups, and it asks before each use. The Query chat sends your questions and the tools' results to the
Anthropic API, and is billed to your key.

## Checking it works

```sh
docker compose ps                         # "healthy"
curl -s http://localhost:3000/healthz     # {"ok":true}
docker compose logs plex-director         # "Plex Director web UI listening on port 3000"
```

If a page shows an error from a service, check its URL and key on the Settings page, and that the container can
reach that address.

## Uninstalling

```sh
cd /opt/plex-director
sudo docker compose down                  # removes the container; ./data stays
sudo docker image rm honeybeartech/plex-director-mcp:latest
```

Remove the `plex-director` entry from `claude_desktop_config.json` if you added it. Then delete `data/` and
`plex-director.env`, which hold your service credentials, or keep a backup if you might come back. Consider
rotating the API keys you gave Plex Director in each app.
