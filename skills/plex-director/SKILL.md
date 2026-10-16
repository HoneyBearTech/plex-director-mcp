---
name: plex-director
description: Answers questions about a home Plex and Servarr media stack and acts on it through the Plex Director MCP server - what the user owns, missing movies and episodes, what to watch next, upcoming episodes, download and indexer health, batch movie upgrades and server health. Use when the user asks about their Plex library, Radarr, Sonarr, Prowlarr, qBittorrent, SABnzbd, Tautulli or media server, and the plex-director MCP tools are available.
license: MIT
compatibility: Needs the Plex Director MCP server (https://github.com/HoneyBearTech/plex-director-mcp) connected to the agent, with the user's own services configured.
---

<!-- Generated from src/guidance.ts by `npm run build:skill`. Edit that file, not this one. -->

# Plex Director

Plex Director connects to the user's own Plex, Radarr, Sonarr, Prowlarr, SABnzbd, qBittorrent and Tautulli, plus TMDb and their Linux hosts over SSH.

## Rules

- Answer from the tools, never from memory: the user's library, downloads and services are only known through them. Report what a tool returns rather than dropping or second-guessing rows.
- Express any narrowing the user asks for (year, genre, library such as 4K, movie or show, watch state) as a tool filter instead of filtering a tool's result yourself. For a follow-up, run the search again with the earlier filters plus the new one.
- If a tool says more results remain, fetch the next page with the offset it gives before saying you have everything.
- A tool that reports a service as unreachable or failing has not found 'nothing'; say the service could not be reached.
- Plex cannot search episode plots across the whole library: plots can only be searched within a named show, so ask which show when the user describes an episode by its plot.
- Never repeat API keys, tokens or passwords, even if one appears in a tool result or an error.
- Tools that change something (confirm_selected_choices, manage_stalled_downloads with PURGE_STALLED, plan_media_upgrade, update_job_status, execute_next_job_step, run_cluster_backup, trust_new_host_key) act on the user's real services. Say what will happen and get the user's go-ahead first; PURGE_STALLED deletes torrents and their files.
- TV is never batch-upgraded: plan_media_upgrade only plans movie upgrades and refuses TV.
- Adding a movie is two steps: search_and_select_movies shows a numbered grid, then confirm_selected_choices adds the numbers the user picks.

## Which tool answers what

- Do I have <title>? What do I own by genre, actor, year, library (e.g. 4K), network, rating, watch state or date added? → search_plex_library
- What should I watch next? Which episode is next in <show>? → get_on_deck
- Which episode of <show> is the one where ...? Episodes that aired in a date range, premieres or finales → search_episodes
- Which of <actor>'s movies or shows do I have, and which am I missing? → resolve_actor_filmography
- Is <movie> in Radarr and monitored? Why is <movie> missing? → check_movie_status, diagnose_missing_media
- Do I have every episode of <show>? Which shows have gaps? → check_series_completeness, find_series_gaps
- Is <show> monitored, what quality profile, what is queued? Why are episodes of <show> missing? → check_series_status, diagnose_missing_episodes
- Which shows do I only have in 720p, or in mixed qualities? → find_series_by_quality
- What's on this week? When does <show> come back? → get_upcoming_episodes
- Add a movie to Radarr → search_and_select_movies, confirm_selected_choices
- Are my indexers healthy? → check_indexer_health
- Which downloads are stalled? Clean them up → manage_stalled_downloads
- Upgrade movies that have no file or are below 1080p, as a paced batch; check, pause, resume or cancel it → plan_media_upgrade, get_background_jobs, update_job_status, execute_next_job_step
- Who is streaming now? What gets watched most? → get_plex_activity, get_library_analytics
- How are my servers doing (CPU, memory, disk, containers)? → get_cluster_infrastructure_health, get_cluster_hardware_analytics
- A host's SSH key changed after I rebuilt it → trust_new_host_key
- Back up Radarr, Sonarr and Prowlarr → run_cluster_backup

## Setup

Install and connect the MCP server as described in the project's [quick start](https://github.com/HoneyBearTech/plex-director-mcp/blob/main/docs/quick-start.md). Each tool's own description explains its arguments.
