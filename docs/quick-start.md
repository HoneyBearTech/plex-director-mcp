# Quick start

This gets Plex Director running on a machine on your home network in a few minutes, first as a web
dashboard and then, if you want, inside Claude Desktop. It uses the published image from Docker Hub. For
every option, pinned versions and running it securely, see [installing.md](installing.md).

You need Docker with Compose, and the URLs and API keys of the services you want to connect (Plex, Radarr,
Sonarr, Prowlarr, SABnzbd, qBittorrent, Tautulli, TMDb). You only need the ones you use.

## 1. Start the dashboard

Make a folder for it, for example `~/plex-director`, and save this as `compose.yaml` inside it:

```yaml
services:
  plex-director:
    image: honeybeartech/plex-director-mcp:latest
    container_name: plex-director
    environment:
      - WEB_PASSWORD=choose-a-password
    volumes:
      - ./data:/app/data
    ports:
      - 3000:3000
    restart: unless-stopped
```

Change `choose-a-password`. `latest` follows the newest build; to choose when you upgrade, pin `1.4.0` instead
([installing.md](installing.md#choose-an-image-and-a-tag)). Then start it:

```sh
docker compose up -d
docker compose ps        # STATUS should say "healthy" after a few seconds
```

Open `http://<this-machine>:3000` (or <http://localhost:3000> on the same machine) and sign in with the
password you chose.

## 2. Connect your services

Open **Settings** and fill in a tab for each service you use: the URL and the API key (for qBittorrent the
username and password, for Plex the token, for TMDb the API Read Access Token). Click **Save** on each tab.
[installing.md](installing.md#where-to-find-each-credential) says where each app shows its key.

Use your server's LAN address in the URLs, such as `http://192.168.1.10:7878`, not `localhost`: inside the
container, `localhost` is the container itself.

Then look around: **Server Status** shows what is playing, **Queues** your downloads, **Indexers** your
Prowlarr indexers. The [user guide](user-guide/dashboard.md) explains each page.

## 3. Turn on the Query chat (optional)

The **Query** page answers questions such as "Which of Harrison Ford's movies do I have in 4K?" using
Claude. It needs a pay-per-use [Anthropic API key](https://console.anthropic.com/), which is separate from a
Claude subscription. Add it to `environment:` in `compose.yaml`:

```yaml
      - ANTHROPIC_API_KEY=sk-ant-your-key
```

and run `docker compose up -d` again. The rest of the dashboard works without it.

## 4. Use it from Claude Desktop (optional)

The same image is also an MCP server. In Claude Desktop, open **Settings → Developer → Edit Config** and add
this to `claude_desktop_config.json`, with the real path to your folder:

```json
{
  "mcpServers": {
    "plex-director": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/absolute/path/to/plex-director/data:/app/data",
        "honeybeartech/plex-director-mcp:latest"
      ]
    }
  }
}
```

Mounting the same `data` folder means it uses the settings you just saved. Restart Claude Desktop, and
`plex-director` appears with its 26 tools. Try "What should I watch next?" or "Do I have every episode of
Severance?". Claude asks before it uses a tool; some tools change things, so read what it proposes.

If Claude Desktop says it can't find `docker`, put the full path in `command` (run `which docker` to see
it).

## What next

- [Installing](installing.md#running-it-securely): lock it down (a non-root, read-only container, the port
  only where you need it) and add SSH host monitoring.
- [Upgrading](upgrading.md): updating to a new version, and backing up the `data` folder, which holds your
  saved API keys.
- Stop it with `docker compose down`. Your settings stay in `./data`.
