# plex-director-mcp

A Claude Desktop MCP server for troubleshooting and managing a self-hosted Plex + Servarr media stack.

This project gives Claude access to your Radarr, SABnzbd, Tautulli, TMDb, and Prowlarr setup so it can help diagnose missing media, monitor Plex activity, and coordinate safe queue-based media operations from inside Claude Desktop.

## What it does

`plex-director-mcp` exposes MCP tools for:

- checking movie status in Radarr
- diagnosing why a movie is missing from the library
- checking active Plex streams and recent library usage through Tautulli
- tracking background media jobs in SQLite
- planning and step-executing safe media upgrade/search jobs
- resolving actor filmographies from TMDb
- checking Prowlarr indexer health and failures
- searching TMDb results when a title is ambiguous and confirming the user-selected choices

This is not a generic Plex wrapper. It is specifically a media-operations assistant for a home media stack.

## Tools included

- `check_movie_status`
- `diagnose_missing_media`
- `get_plex_activity`
- `get_library_analytics`
- `get_background_jobs`
- `update_job_status`
- `plan_media_upgrade`
- `execute_next_job_step`
- `resolve_actor_filmography`
- `check_indexer_health`
- `search_and_select_movies`
- `confirm_selected_choices`

## Claude Desktop setup

This repo is intended to be used as a local MCP server from Claude Desktop.

### 1) Install dependencies

```bash
npm install
```

### 2) Create a `.env` file

Create a `.env` file in the repo root with your service URLs and API keys:

```env
RADARR_URL=http://radarr:7878
RADARR_API_KEY=your_radarr_api_key
SABNZBD_URL=http://sabnzbd:8080
SABNZBD_API_KEY=your_sabnzbd_api_key
TAUTULLI_URL=http://tautulli:8181
TAUTULLI_API_KEY=your_tautulli_api_key
TMDB_API_KEY=your_tmdb_api_key
PROWLARR_URL=http://prowlarr:9696
PROWLARR_API_KEY=your_prowlarr_api_key
```

### 3) Add the server to Claude Desktop

Open Claude Desktop Settings and add an MCP server config similar to this:

```json
{
  "mcpServers": {
    "plex-director": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/absolute/path/to/plex-director-mcp/src/index.ts"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

Replace `/absolute/path/to/plex-director-mcp` with the real path to this repo on your machine.

### 4) Restart Claude Desktop

After saving the config, restart Claude Desktop and the `plex-director` server should appear as an MCP tool provider.

## Local development

Run the server directly:

```bash
npm run start
```

The server runs via stdio and waits for MCP client connections.

## Runtime notes

- Uses the official MCP SDK
- Stores persistent job state and selection context in a local SQLite database: `plex_director.db`
- Loads configuration from `.env`
- Intended for local self-hosted media automation and troubleshooting

## Why this exists

If your Plex library is missing content, your downloads are failing, your indexers are unhealthy, or you want Claude to help inspect your media stack, this MCP gives it the runtime context it needs to inspect the system and act on the most likely causes.

This project is designed specifically for a home-run Servarr ecosystem, with the goal of making the stack easier to diagnose and operate from within Claude Desktop.
