# Assurance case

This document argues that Plex Director meets its [security requirements](security.md). It describes the
threat model, identifies the trust boundaries, shows how secure design principles were applied, and lists
how common implementation weaknesses are countered, with pointers to the code and tests behind each
claim. The component overview is in [architecture.md](architecture.md).

The top-level claim is:

> **Deployed as documented (on a trusted LAN, with `WEB_PASSWORD` set), Plex Director discloses stored
> service credentials to no one, lets only the signed-in user read or change its settings, and changes
> anything in the user's media services only when a person has asked for it through an MCP client that
> confirms tool calls, at a bounded rate.**

It rests on four arguments: the threat model is understood (1), every trust boundary is mediated (2), the
design follows secure design principles (3), and the implementation counters common weaknesses and is
continuously checked (4, 5). Where a claim has limits, they are stated here and in
[security.md](security.md#what-plex-director-does-not-protect-against).

## 1. Threat model

**Assets**, most valuable first: the service credentials (Radarr, Sonarr, Prowlarr, SABnzbd and Tautulli
API keys, the qBittorrent password, the Plex token, the TMDb token), the Anthropic API key and the SSH
private key; the ability to change the media stack (add movies, start searches, delete torrents and their
files, run backups); the session-signing secret and `WEB_PASSWORD`; the media library's contents and watch
history (personal data); the SSH host keys Plex Director trusts.

**Actors and what they may try:**

| Actor | Trusted with | Threats considered |
| --- | --- | --- |
| Unauthenticated LAN client | Nothing | Guess the password, forge or replay a session cookie, read settings, use the image proxies to reach other URLs, cross-site requests from a page the user visits. |
| Signed-in dashboard user | Everything the dashboard offers (single user) | Out of scope as an attacker: the owner. Their browser must not be able to read stored secrets. |
| MCP client user | All 26 tools and every credential | Out of scope as an attacker: whoever can launch the process already holds the env file. |
| The LLM (chat or MCP client) | Choosing tool calls | Be steered by injected text into calling tools the user did not want, or into leaking data. |
| Hostile content in a service | Nothing | Titles, summaries, torrent names, indexer messages or host output crafted to inject into the LLM, the dashboard (XSS), shell commands or service requests. |
| A compromised LAN service or impostor host | Nothing | Return malicious responses; impersonate an SSH host to capture commands or feed false data. |
| Network attacker on the LAN | Nothing | Intercept plain-HTTP traffic to services or the dashboard. |
| Supply-chain attacker | Nothing | Ship a malicious or vulnerable dependency, base image or Action; tamper with a published image. |

**Out of scope:** anyone with access to the host, the Docker daemon or the data volume; a deployment
exposed directly to the internet; a malicious owner; vulnerabilities in Plex, the Servarr apps, the
download clients, TMDb or the Anthropic API; what a user approves an MCP client to do.

## 2. Trust boundaries

| # | Boundary | What crosses it | How it is mediated |
| --- | --- | --- | --- |
| B1 | Browser → dashboard (`WEB_PORT`) | HTTP requests, the session cookie, chat history | `requireAuth` on every `/api` route except `/api/auth/*` (`src/web/app.ts`, `src/web/auth.ts`); HMAC-signed `HttpOnly`, `SameSite=Strict` cookie checked with `timingSafeEqual`; login limiter (10 failures / 15 min) and global limiter (300 / min); 1 MB body limit; JSON-only bodies; secrets never returned (`src/web/routes/settings.ts`); untrusted history parsed and capped (`parseHistory`, `buildHistoryMessages`). |
| B2 | MCP client → MCP server (stdio) | JSON-RPC tool calls | Only the process that launched the server can write to its stdin; the MCP SDK validates every call's arguments against the tool's zod schema (`server.tool(...)` in `src/tools/`); the client's own approval prompt; nothing but protocol messages on stdout (`quiet: true` in `src/env.ts`, logs on stderr). |
| B3 | Server → Anthropic API | The question, bounded history, tool definitions and tool results | HTTPS through the official SDK; only the 12 read-only `movieTools` are offered (`buildTools` in `src/web/chat.ts`); at most 4 tool rounds and 1,024 output tokens per call; unknown tool names are answered with an error, not executed. |
| B4 | LLM output → tool handlers | Tool names and arguments chosen by a model | In the chat, only read-only handlers can be reached, each checks its arguments against the tool's zod schema before running (`withValidation` in `src/tools/movies.ts`, tested in `test/tools.test.ts`), and handlers clamp their own limits (for example `Math.min(Math.max(...))` in `src/tools/plex.ts`, `series.ts`, `upcoming.ts`); in an MCP client, the same zod validation plus the client's approval prompt. |
| B5 | Server → LAN services and TMDb | Requests carrying credentials | URLs come only from the settings store, set by the signed-in user; credentials sent as headers or parameters by the per-service axios clients (`src/clients.ts`) with a 10-second timeout; user text is URL-encoded (`encodeURIComponent`) or passed as `params`. |
| B6 | Service responses → server, LLM and browser | Untrusted data from services and, through them, the internet | Typed mapping of the fields used (for example `src/web/routes/queues.ts`, `src/indexers.ts`); React text rendering with no HTML (`web/src/components/ChatText.tsx`); chat images restricted to four image MIME types (`SUPPORTED_IMAGE_TYPES` in `src/web/chat.ts`); Markdown table cells escaped (`escapeTableCell` in `src/util.ts`); poster URLs are same-origin proxy paths (`plexPosterUrl` in `src/tools/plex.ts`). |
| B7 | Browser → artwork proxies → Plex / Tautulli | An image path from the query string | Strict allowlist regex before any request (`/^\/library\/metadata\/\d+\/thumb\/\d+$/` in `src/web/routes/plex.ts`, with `thumb\|art` in `src/web/routes/status.ts`); the request goes only to the configured Plex or Tautulli base URL, with fixed sizes. |
| B8 | Server → SSH hosts | A fixed telemetry script; the host's output | Key authentication (`src/ssh.ts`); host key pinned on first use and refused on mismatch before any command (`hostVerifier`, `checkHostKey` in `src/hostKeys.ts`); commands are constants (`combinedCmd` in `src/cluster.ts`); output parsed into numbers and names only (`parseProbeOutput`). |
| B9 | Job runner → Radarr | One search per tick | Only `RUNNING` jobs, one item per interval across all jobs, atomic claim before the search (`stepJob` in `src/jobs.ts`), auto-pause after 3 failures (`src/jobRunner.ts`). |
| B10 | Maintainer / CI → published images | Source, dependencies, images | Protected `main` with required checks; SHA-pinned Actions; digest-pinned base images; `npm ci` from lockfiles; `npm audit --audit-level=high`; CodeQL; smoke test before publish; cosign keyless signing (`.github/workflows/ci.yml`). |

### Attack surface

| Entry point | Reachable by | Main protections | Critical code paths |
| --- | --- | --- | --- |
| Dashboard and `/api` (port 3000) | anyone who can reach the port | password session, rate limits, write-only secrets, body limit | `src/web/app.ts`, `src/web/auth.ts`, `src/web/routes/` |
| Sign-in (`POST /api/auth/login`) | anyone who can reach the port | scrypt, constant-time compare, 10 failures / 15 min | `src/web/auth.ts` |
| Artwork proxies (`/api/plex/image`, `/api/status/image`) | signed-in users | allowlist regex, fixed upstream | `src/web/routes/plex.ts`, `src/web/routes/status.ts` |
| Query chat (`POST /api/chat/movies`) | signed-in users | read-only tools, bounded history and rounds | `src/web/chat.ts`, `src/web/routes/chat.ts` |
| Settings (`PUT /api/settings/{service}`) | signed-in users | fixed field allowlist per service, strings only | `src/web/routes/settings.ts` |
| Trust new key (`POST /api/nodes/trust-new-key`) | signed-in users; refused (403) when `WEB_PASSWORD` is unset | only configured hosts | `src/web/routes/nodes.ts`, `src/cluster.ts` |
| `trust_new_host_key` (MCP) | the MCP client user, after the client's approval prompt | only configured hosts | `src/tools/infrastructure.ts`, `src/cluster.ts` |
| MCP stdio | the process that launched it | zod schemas, client approval | `src/index.ts`, `src/tools/` |
| Service responses | whoever controls a service or its content | typed mapping, text-only rendering, escaped tables | `src/tools/`, `web/src/components/ChatText.tsx` |
| SSH hosts | whoever controls a host or the path to it | TOFU host key, constant commands | `src/ssh.ts`, `src/cluster.ts`, `src/hostKeys.ts` |
| The release pipeline | the maintainer, GitHub Actions | pinned actions, audits, signing | `.github/workflows/ci.yml` |

These are reviewed whenever a change adds an entry point or touches one of these paths (the pull request
says so), and at each release.

## 3. Secure design principles

- **Economy of mechanism.** One process, one SQLite file, one shared password. Each capability is
  implemented once and shared by the MCP tools and the dashboard (`movieTools` in `src/tools/movies.ts`,
  `src/cluster.ts`, `src/qbittorrent.ts`, `src/indexers.ts`), so a fix lands everywhere at once. Sessions
  are stateless (expiry + HMAC), with nothing to store or clean up. Nine runtime dependencies.
- **Fail-safe defaults.** Jobs are created `PENDING` and never start themselves; a paused, cancelled or
  completed job is never stepped (`stepJob`); three failures pause a job; TV upgrades are refused; a
  changed SSH host key is refused until a person approves it; unknown `/api` paths return a JSON `404`
  rather than falling through; blank secrets in a save keep the stored value; an unknown chat tool is an
  error, not a guess. The one unsafe default, an open dashboard when `WEB_PASSWORD` is unset, is announced
  in the log and with a banner, and documented as unsupported.
- **Complete mediation.** `requireAuth` is mounted on the whole `/api` prefix after the public auth router,
  so a new route is protected without opting in (`src/web/app.ts`); `test/web.test.ts` ("locks the API but
  not the health check, the login endpoints, or the SPA") checks it. Every MCP tool call passes the SDK's
  schema validation, and every Query chat tool call passes the same zod schema in the handler.
- **Open design.** The code, this document and the threat model are public. Security rests on the
  password, keys and tokens, not on secrecy of the design.
- **Separation of privilege.** Changing the media stack needs the MCP surface (with the client's approval
  prompt); the dashboard and its chat can only read. Adding a movie needs a search and then a separate
  confirmation. `WEB_PASSWORD` is env-only, so the dashboard cannot change its own protection.
- **Least privilege.** The chat's model gets read-only tools; the dashboard gets no job control; the SSH
  user only needs to run read-only commands and `docker ps`; the container runs as a non-root user (UID 65532)
  and can run with a read-only filesystem and no capabilities (documented in the README); CI jobs have `contents: read` by
  default and get `packages: write` / `id-token: write` only in the publish job.
- **Least common mechanism.** The MCP and web surfaces share logic but not state beyond the database; the
  job claim makes concurrent processes safe without a shared lock.
- **Psychological acceptability.** It boots with no configuration and is set up from a Settings page; the
  secure options (password, non-root) are one line each; a changed host key is explained in plain words
  with one button to resolve it; secrets never need to be copied out of the app.
- **Limited attack surface.** One published port; no file browser, shell or "reveal secret" endpoint; no
  inbound connections from services; the dashboard's write endpoints are limited to settings, sign-in and
  host key approval.
- **Input validation with allowlists.** Settings fields are an allowlist per service; image paths match a
  strict regex; MCP arguments use zod enums and ranges; Radarr root folders must match one Radarr reports;
  only configured hosts can have their key reset.

## 4. Countering common implementation weaknesses

Mapped to the [OWASP Top 10 (2021)](https://owasp.org/Top10/), the
[OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) and the
[CWE Top 25](https://cwe.mitre.org/top25/):

| Weakness | Countermeasures | Limits |
| --- | --- | --- |
| **Broken access control** (A01; CWE-862, CWE-352 CSRF) | `requireAuth` on all of `/api` (`src/web/app.ts`); `SameSite=Strict` session cookie; request bodies are parsed only as JSON, so a cross-site form cannot submit one and a cross-site `fetch` with JSON needs a CORS preflight the server never grants; job control is not exposed on the web at all (`src/web/routes/jobs.ts` is read-only). | Single shared password, no roles. With `WEB_PASSWORD` unset there is no access control. |
| **Cryptographic failures** (A02; CWE-327, CWE-916, CWE-798, CWE-311) | scrypt key derivation for the password, HMAC-SHA-256 sessions, `crypto.timingSafeEqual` for both comparisons, a random 32-byte salt from `crypto.randomBytes` (`src/web/auth.ts`); service credentials encrypted at rest with AES-256-GCM, a random 96-bit IV per value and the setting's name as associated data, with a 256-bit key from `SETTINGS_ENCRYPTION_KEY` (`src/secretBox.ts`, `test/secrets.test.ts`); start-up refuses a malformed key, or a missing or wrong key while encrypted values exist; no hard-coded credentials; TMDb and Anthropic calls use HTTPS. | Encryption at rest is opt-in (unset, credentials stay plain text and start-up warns); no key rotation; LAN services are often plain HTTP. |
| **Injection** (A03; CWE-78 OS command, CWE-89 SQL, CWE-79 XSS, CWE-74) | **SSH:** commands are string constants (`src/cluster.ts`); nothing from users, settings or services is interpolated, and the host and user are connection parameters, not command text (`src/ssh.ts`). **SQL:** every query is a `better-sqlite3` prepared statement with `?` parameters (`src/db.ts`, `src/settings.ts`, `src/jobs.ts`, `src/hostKeys.ts`). **XSS:** React escapes all text, `ChatText` renders only bold, italics, code and bullets (no HTML, links or `dangerouslySetInnerHTML`), chat images are `data:` URIs limited to four image types. **Service requests:** user text is `encodeURIComponent`-encoded or sent as axios `params`; Markdown table cells are escaped (`escapeTableCell`, a CodeQL finding fixed). | The artwork proxies pass the upstream `Content-Type` through. |
| **Prompt injection** (LLM01, LLM06 excessive agency) | The chat offers only 12 read-only tools, so injected text cannot add, delete or start anything from the dashboard (`buildTools` in `src/web/chat.ts`); at most 4 tool rounds; the reply is rendered as text without links or remote images, which closes the usual "render an image URL to exfiltrate" channel; the system prompt tells the model to report tool results, not act on them. In MCP clients, write tools are separate, named for what they do, and need the client's approval; adding movies is a two-step choose-then-confirm. | A crafted title or summary can still mislead an answer. In an MCP client with approval turned off, a model could be steered into a write tool. |
| **Insecure design** (A04) | Threat model and boundaries above; bulk actions designed as rate-limited, resumable, confirmed jobs; TV mass upgrades refused by policy (`plan_media_upgrade` in `src/tools/jobs.ts`). | |
| **Security misconfiguration** (A05) | Startup warning and UI banner when `WEB_PASSWORD` is unset; distroless image; `.dockerignore` keeps `.env`, databases and keys out of the build; non-root user by default (from 1.3.0), read-only operation documented in the README; `X-Frame-Options`, `frame-ancestors`, `nosniff` and `Referrer-Policy` headers (`src/web/app.ts`); a `Host` allowlist when `WEB_PASSWORD` is unset (`src/web/hostCheck.ts`). | No full script/style CSP yet. |
| **Vulnerable and outdated components** (A06; CWE-1104) | Lockfiles with integrity hashes and `npm ci`; `npm audit --audit-level=high` in CI for both npm projects; Dependabot weekly for npm (both projects), Docker and Actions; digest-pinned images; SHA-pinned Actions; dependency review on every pull request; gitleaks secret scanning on every push and pull request. See [dependencies.md](dependencies.md). | Docker Scout image scan is reported but not yet blocking. |
| **Identification and authentication failures** (A07; CWE-287, CWE-307, CWE-384, CWE-613) | Rate-limited login counting only failures; slow scrypt per attempt; stateless sessions with a 7-day expiry checked on every request; password change revokes all sessions; `Secure` cookie flag over HTTPS. | No per-session revocation or idle timeout; no second factor. |
| **Software and data integrity failures** (A08; CWE-502, CWE-345) | No deserialization of untrusted objects (JSON only, `safeJsonParse` for stored job payloads); images signed with cosign keyless signing; smoke test before publish; Dependabot auto-merge only for minor and patch updates and only after required checks pass; an SPDX SBOM and SLSA provenance attached to each published image (from v1.2.0); DCO sign-off checked on every pull request. | Release tags are signed only from v1.2.0; release notes are generated from pull request titles. |
| **Logging and monitoring failures** (A09; CWE-532, CWE-778) | Logs go to stderr (stdout is reserved for MCP); secrets are not logged; job pauses and completions are logged and sent to Discord. | No audit log of sign-ins or settings changes. |
| **Server-side request forgery** (A10; CWE-918) | The artwork proxies accept only a strict Plex metadata path (regex) and send it to the configured Plex or Tautulli server with fixed parameters, so they cannot be pointed at another host or path (`src/web/routes/plex.ts`, `src/web/routes/status.ts`, tested in `test/web.test.ts` "rejects anything that isn't a Plex thumb path"). Service base URLs come only from settings. | The signed-in user chooses service URLs, and the stored key for a service goes to whatever URL is saved for it. `check_movie_status` downloads a poster URL taken from Radarr's metadata. |
| **Secrets exposure** (CWE-200, CWE-522) | Settings API returns `{ configured }` for secrets (`test/web.test.ts` "never returns a secret's value"); proxies keep the Plex token and Tautulli key server-side; SSH key path and Anthropic key env-only; tests run with credentials stripped from the environment and a throwaway database (`test/setup.ts`, `test/isolation.test.ts`). | Without `SETTINGS_ENCRYPTION_KEY`, anyone who can read `/app/data` can read the credentials; with it, they also need the container's environment. |
| **Resource exhaustion** (CWE-400, CWE-770) | 1 MB body limit; 300 requests / minute; 10-second timeout on every service client; chat history and tool rounds bounded; result limits clamped in handlers; one job item per interval; one SSH connection per host per probe. | |
| **Memory-safety weaknesses** (CWE-787, CWE-125, CWE-416) | Written in TypeScript on Node.js, a memory-safe runtime. Native code is limited to `better-sqlite3` and `ssh2`'s optional bindings. | |

## 5. Verification evidence

- **Automated tests** on every push and pull request (`npm test`, Node's built-in runner): authentication,
  session tokens and the auth middleware (`test/auth.test.ts`), the web API including secret handling and
  the image proxy allowlist (`test/web.test.ts`), SSH host key pinning against a real in-process SSH
  server (`test/ssh.test.ts`, `test/sshServer.ts`), job claiming and the runner (`test/jobs.test.ts`),
  every tool (`test/tools.test.ts` and per-feature tests), and the stdio transport (`test/stdio.test.ts`).
  `test/isolation.test.ts` fails the run if a test could reach the real database, `.env`, credentials or
  network.
- **Static analysis:** TypeScript typecheck of the backend, tests and dashboard; CodeQL
  (`javascript-typescript`) on every push, pull request and weekly.
- **Supply chain:** `npm audit --audit-level=high` for both npm projects on every pull request; Dependabot;
  OpenSSF Scorecard weekly; digest-pinned images and SHA-pinned Actions; cosign signatures on every
  published image.
- **Runtime check:** every CI run builds the image and boots it with dummy configuration, confirming both
  the MCP server and the dashboard start, before anything is published.
- **Process:** changes land through pull requests to protected `main` with required checks; vulnerability
  handling as in [SECURITY.md](../SECURITY.md).

This case is updated when the design changes; a claim here that no longer matches the code is a bug.
