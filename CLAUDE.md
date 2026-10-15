# plex-director-mcp — Project Context for Claude Code

Self-hosted assistant for a Plex + Servarr media stack: one Node process that is both an MCP server (stdio) and a web dashboard with an AI chat.

## Before Making Structural Changes
Read the project's notes first. They live outside this repo, in the owner's Obsidian vault **Chronos** at `~/Chronos/Projects/plex-director-mcp/` (every file is prefixed `plex-`):
- `plex-roadmap.md` — feature roadmap by phase, the OpenSSF phase, and the Icebox for new ideas
- `plex-Pass-Map.md` — pass-by-pass delivery log (what shipped in which PR/commit); add a row when a pass ships
- `plex-architecture.md` — current architecture, the two surfaces (MCP tools and web) and how they share logic
- `plex-Security-Considerations.md` — credentials, trust boundaries, LLM tool-calling risks and a checklist (this app holds API keys for every service and can act on them; treat security notes as load-bearing)
- `plex-decision-log.md` — dated log of why past decisions were made (newest first)
- `plex-UI-Design.md` — visual direction for the dashboard
- `plex-dev-gotchas.md`, `plex-known-issues.md`, `plex-infrastructure.md` — traps found during development, open bugs, and the owner's environment

Update these as work lands: tick roadmap checkboxes, add a Pass-Map row, add a dated decision-log entry for architectural choices. Never delete items from the notes; check them off or strike them through with a reason.

**The notes never go into this repo.** They moved to Chronos on 2026-09-29. Don't copy them back in. Chronos is versioned in its own private repo; only commit or push it when the owner asks. The old in-repo vault path `.obsidian-docs/` stays gitignored. Public, user-facing docs go in `docs/`.

## Stack
- Node 24, TypeScript (ESM), run with `tsx`. MCP via `@modelcontextprotocol/sdk` (stdio). Express for the dashboard API.
- Frontend: React + Vite in `web/` (its own `package.json` and lockfile).
- SQLite (`better-sqlite3`) at `/app/data/plex_director.db` for settings, job history and the session secret.
- Anthropic SDK for the dashboard's Query chat (real tool calling, not heuristics).
- Shipped as a Docker image to Docker Hub (`honeybeartech/plex-director-mcp`) and GHCR, signed with cosign keyless. Release on `v*.*.*` tags.

## Conventions
- **Register each capability once.** MCP tools and the web chat share logic modules; forked copies have drifted before. The web chat calls the same tool handlers.
- **Settings DB overrides `.env`** once seeded: editing `.env` for a service setting silently does nothing. Change it on the Settings page or in the DB.
- When a tool is added or removed, update the README tool list and the pinned tool count in `test/stdio.test.ts`.
- Tests must never touch the real DB, `.env` or services (see `test/isolation.test.ts`). Never print secret values; Sonarr history and Prowlarr payloads carry API keys.
- Anything that changes a real system (adds media, starts jobs, deletes) must be explicit and confirmed. `plan_media_upgrade` deliberately rejects TV.
- No secrets, keys, tokens or `.env` files committed, ever. Extend `.gitignore` rather than working around it.
- One branch and PR per change; commits signed off (`git commit -s`, DCO). The owner merges.
- Keep the repo on track for OpenSSF Baseline L1/L2 and Best Practices Passing/Silver (project 15521). Say so before a change that would break a met criterion.

## Commands
- `npm ci` — install root deps; `cd web && npm ci` for the frontend
- `npm start` — run the MCP server + dashboard (`tsx src/index.ts`; dashboard on `WEB_PORT`, default 3000)
- `cd web && npm run dev` — frontend dev server; `npm run build` — production build to `web/dist`
- `npm test` — full test suite (node:test via tsx)
- `npx tsc --noEmit` — typecheck (run in root and in `web/`)
- `npm audit --audit-level=high` — the CI audit gate (run in root and in `web/`)
- Lint / format: not set up yet (planned; see roadmap)
- `docker build -t plex-director-mcp .` — build the image locally
