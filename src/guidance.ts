// How an assistant should use Plex Director's tools, written once and shared
// by every surface that briefs a model: the MCP server's `instructions`
// (src/server.ts), the dashboard chat's system prompt (src/web/chat.ts) and
// the Agent Skill (skills/plex-director/SKILL.md, generated from this file by
// `npm run build:skill`; a test fails if the committed copy drifts).
//
// Each tool's own description says how to call it. This holds what no single
// description can: rules that apply across tools, and which tool answers
// which kind of question.

export interface Route {
  question: string;
  tools: string[];
}

// Rules for every surface. Keep each one short and true of the code.
export const RULES: string[] = [
  "Answer from the tools, never from memory: the user's library, downloads and services are only known through them. Report what a tool returns rather than dropping or second-guessing rows.",
  "Express any narrowing the user asks for (year, genre, library such as 4K, movie or show, watch state) as a tool filter instead of filtering a tool's result yourself. For a follow-up, run the search again with the earlier filters plus the new one.",
  "If a tool says more results remain, fetch the next page with the offset it gives before saying you have everything.",
  "A tool that reports a service as unreachable or failing has not found 'nothing'; say the service could not be reached.",
  "Plex cannot search episode plots across the whole library: plots can only be searched within a named show, so ask which show when the user describes an episode by its plot.",
  "Never repeat API keys, tokens or passwords, even if one appears in a tool result or an error.",
];

// Rules only for clients that can change things (the MCP tools; the chat is read-only).
export const CHANGE_RULES: string[] = [
  "Tools that change something (confirm_selected_choices, manage_stalled_downloads with PURGE_STALLED, plan_media_upgrade, update_job_status, execute_next_job_step, run_cluster_backup, trust_new_host_key) act on the user's real services. Say what will happen and get the user's go-ahead first. PURGE_STALLED deletes torrents and their files: run AUDIT, show the user the list, and pass only the hashes they agreed to.",
  "TV is never batch-upgraded: plan_media_upgrade only plans movie upgrades and refuses TV.",
  "Adding a movie is two steps: search_and_select_movies shows a numbered grid, then confirm_selected_choices adds the numbers the user picks.",
];

export const ROUTES: Route[] = [
  {
    question:
      "Do I have <title>? What do I own by genre, actor, year, library (e.g. 4K), network, rating, watch state or date added?",
    tools: ["search_plex_library"],
  },
  {
    question: "What should I watch next? Which episode is next in <show>?",
    tools: ["get_on_deck"],
  },
  {
    question:
      "Which episode of <show> is the one where ...? Episodes that aired in a date range, premieres or finales",
    tools: ["search_episodes"],
  },
  {
    question: "Which of <actor>'s movies or shows do I have, and which am I missing?",
    tools: ["resolve_actor_filmography"],
  },
  {
    question: "Is <movie> in Radarr and monitored? Why is <movie> missing?",
    tools: ["check_movie_status", "diagnose_missing_media"],
  },
  {
    question: "Do I have every episode of <show>? Which shows have gaps?",
    tools: ["check_series_completeness", "find_series_gaps"],
  },
  {
    question:
      "Is <show> monitored, what quality profile, what is queued? Why are episodes of <show> missing?",
    tools: ["check_series_status", "diagnose_missing_episodes"],
  },
  {
    question: "Which shows do I only have in 720p, or in mixed qualities?",
    tools: ["find_series_by_quality"],
  },
  {
    question: "What's on this week? When does <show> come back?",
    tools: ["get_upcoming_episodes"],
  },
  {
    question: "Add a movie to Radarr",
    tools: ["search_and_select_movies", "confirm_selected_choices"],
  },
  { question: "Are my indexers healthy?", tools: ["check_indexer_health"] },
  { question: "Which downloads are stalled? Clean them up", tools: ["manage_stalled_downloads"] },
  {
    question:
      "Upgrade movies that have no file or are below 1080p, as a paced batch; check, pause, resume or cancel it",
    tools: [
      "plan_media_upgrade",
      "get_background_jobs",
      "update_job_status",
      "execute_next_job_step",
    ],
  },
  {
    question: "Who is streaming now? What gets watched most?",
    tools: ["get_plex_activity", "get_library_analytics"],
  },
  {
    question: "How are my servers doing (CPU, memory, disk, containers)?",
    tools: ["get_cluster_infrastructure_health", "get_cluster_hardware_analytics"],
  },
  {
    question: "A host's SSH key changed after I rebuilt it",
    tools: ["trust_new_host_key"],
  },
  { question: "Back up Radarr, Sonarr and Prowlarr", tools: ["run_cluster_backup"] },
];

// The question-to-tool map, limited to the tools a surface actually has.
export function renderRoutes(available?: ReadonlySet<string>): string {
  return ROUTES.map((r) => ({
    ...r,
    tools: available ? r.tools.filter((t) => available.has(t)) : r.tools,
  }))
    .filter((r) => r.tools.length > 0)
    .map((r) => `- ${r.question} → ${r.tools.join(", ")}`)
    .join("\n");
}

const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

// For MCP clients (Claude Desktop and others): sent in the initialize result.
export const SERVER_INSTRUCTIONS = [
  "Plex Director connects to the user's own Plex, Radarr, Sonarr, Prowlarr, SABnzbd, qBittorrent and Tautulli, plus TMDb and their Linux hosts over SSH.",
  `Rules:\n${bullets([...RULES, ...CHANGE_RULES])}`,
  `Which tool answers what:\n${renderRoutes()}`,
].join("\n\n");

// For the dashboard chat, which only has the read-only tools in `available`.
export function chatGuidance(available: ReadonlySet<string>): string {
  return [`RULES:\n${bullets(RULES)}`, `WHICH TOOL ANSWERS WHAT:\n${renderRoutes(available)}`].join(
    "\n\n",
  );
}

// The Agent Skill file. Frontmatter follows https://agentskills.io/specification
// (`name` must match the folder name).
export function renderSkill(): string {
  return `---
name: plex-director
description: Answers questions about a home Plex and Servarr media stack and acts on it through the Plex Director MCP server - what the user owns, missing movies and episodes, what to watch next, upcoming episodes, download and indexer health, batch movie upgrades and server health. Use when the user asks about their Plex library, Radarr, Sonarr, Prowlarr, qBittorrent, SABnzbd, Tautulli or media server, and the plex-director MCP tools are available.
license: MIT
compatibility: Needs the Plex Director MCP server (https://github.com/HoneyBearTech/plex-director-mcp) connected to the agent, with the user's own services configured.
---

<!-- Generated from src/guidance.ts by \`npm run build:skill\`. Edit that file, not this one. -->

# Plex Director

${SERVER_INSTRUCTIONS.split("\n\n")[0]}

## Rules

${bullets([...RULES, ...CHANGE_RULES])}

## Which tool answers what

${renderRoutes()}

## Setup

Install and connect the MCP server as described in the project's [quick start](https://github.com/HoneyBearTech/plex-director-mcp/blob/main/docs/quick-start.md). Each tool's own description explains its arguments.
`;
}
