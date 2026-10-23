# Security requirements

This page says what you can and cannot expect from Plex Director in terms of security. The reasoning
behind it (threat model, trust boundaries, design principles and how common weaknesses are countered) is
in the [assurance case](assurance-case.md). To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Intended deployment

Plex Director is meant for **one household on a trusted home network**: one person (or people who already
share the media stack's admin access) running it next to their own Plex and Servarr apps. It is **not**
designed or tested to be exposed to the public internet. The rest of this page assumes that deployment,
with `WEB_PASSWORD` set and the advice in the README's [Security](../README.md#security) section followed.

## What Plex Director protects

**The dashboard**

- With `WEB_PASSWORD` set, every `/api` route except the health check (`/healthz`) and the sign-in
  endpoints (`/api/auth/status`, `/api/auth/login`, `/api/auth/logout`) answers `401` without a valid
  session (`requireAuth` in `src/web/auth.ts`, applied to all of `/api` in `src/web/app.ts`). The static
  app itself is public so the sign-in page can load; it contains no data or secrets.
- A session is a signed, `HttpOnly`, `SameSite=Strict` cookie (`pd_session`) valid for 7 days, marked
  `Secure` when the request arrived over HTTPS. It is an expiry time plus an HMAC-SHA-256 signature; the
  signing key is derived with scrypt from `WEB_PASSWORD` and a random 32-byte secret kept in the database.
  Changing the password ends every session.
- Password checks run scrypt on the attempt and compare in constant time. Failed sign-ins are limited to
  10 per 15 minutes per client address; every request is limited to 300 per minute per address.
- `WEB_PASSWORD` is read from the environment only. It cannot be set or changed from the dashboard.
- Request bodies are limited to 1 MB.

**Credentials**

- Service API keys, tokens and passwords are **write-only** through the dashboard: `GET /api/settings`
  returns only `{ "configured": true|false }` for each secret, and a blank secret in a save keeps the stored
  value (`src/web/routes/settings.ts`).
- The Plex token and the Tautulli API key never reach the browser: posters are fetched by the server
  through `/api/plex/image` and `/api/status/image`, which accept only Plex artwork paths of the form
  `/library/metadata/<id>/thumb/<id>` (and `/art/` for Tautulli), checked before any request is made.
- The SSH private key is a file path (`SSH_KEY_PATH`) set in the environment. It is never stored in the
  database, shown in the dashboard or settable from it. `ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL`,
  `SSH_KEY_PASSPHRASE` and `WEB_PASSWORD` are env-only too.
- The image is built without `.env`, the local database or key files (`.dockerignore`).

**Actions that change things**

- The dashboard is read-only for anything that touches your services, apart from saving settings and
  approving a changed SSH host key: it cannot add movies, delete downloads, or start, pause or cancel jobs.
- The Query chat can only use the 12 read-only tools in `movieTools` (`src/tools/movies.ts`); it has no
  tool that adds, deletes or starts anything.
- Batch jobs are created `PENDING` and never start on their own; the job runner sends at most one Radarr
  search per interval (60 seconds by default) and pauses a job after three failures in a row.
  `plan_media_upgrade` refuses TV outright.
- Adding movies is a two-step pick-then-confirm flow (`search_and_select_movies`, then
  `confirm_selected_choices`), and a requested root folder must be one Radarr already has.

**SSH host monitoring**

- Key authentication only. The commands sent are a fixed, read-only telemetry script built from constants
  in `src/cluster.ts`; no user or service input is ever part of a command.
- Each host's key fingerprint (SHA-256) is remembered the first time it connects. A different key is
  refused before authentication completes and before any command runs, and the Node Utilization page shows
  the host as offline with the reason. Only a host in the configured host list can have its remembered key
  cleared: with **Trust new key**, which needs `WEB_PASSWORD` (with no login it is refused, since anyone on
  the network could otherwise trust an impostor), or with the `trust_new_host_key` MCP tool.

**Input from outside**

- Tool arguments from MCP clients are validated against zod schemas before a handler runs; handlers also
  clamp limits and counts themselves.
- Chat history sent by the browser is treated as untrusted: only well-formed turns are kept, capped at 12
  turns of 4,000 characters, and table rows are reduced to a few typed fields.
- Text from the model and from services is rendered by React as plain text; the chat renderer
  (`web/src/components/ChatText.tsx`) supports bold, italics, code and bullets only, with no HTML, links
  or remote images.
- User text passed to service APIs is URL-encoded or sent as request parameters; database access always
  uses prepared statements with bound parameters.
- Every outgoing request has a 10-second timeout (`src/clients.ts`).

## What Plex Director does not protect against

- **Anyone who can reach the port when `WEB_PASSWORD` is unset.** Without a password the dashboard is open,
  including the Settings page; the server logs a warning and the dashboard shows a banner. Set it.
- **Other people on your network.** There is one shared password and no user accounts, roles or audit
  log. Everyone who signs in can do everything the dashboard allows. It is not multi-user and has no
  tenant isolation.
- **A hostile network.** Plex Director does not terminate TLS, and calls to your LAN services use whatever
  URL you configured (often plain `http://`). Keep it on a network you trust, and put an HTTPS reverse
  proxy in front if you reach it from elsewhere.
- **Revoking a single session.** Sessions are stateless; signing out only clears your browser's copy. To
  end every session, change `WEB_PASSWORD`.
- **Anyone who can read the data volume.** Without `SETTINGS_ENCRYPTION_KEY`, service credentials are stored
  **unencrypted** in the SQLite database at `/app/data`; with it they are encrypted with AES-256-GCM
  (`src/secretBox.ts`), so the volume alone doesn't reveal them. The session-signing secret is never
  encrypted (it is a salt; signing also needs `WEB_PASSWORD`). Someone who can read the container's
  environment has the key too. Protect the directory and its backups either way.
- **What the MCP client or its model decides to do.** Through Claude Desktop (or another MCP client) a
  model can call every tool, including `confirm_selected_choices` (adds movies and starts downloads),
  `manage_stalled_downloads` with `PURGE_STALLED` (deletes the torrents named by hash from an earlier `AUDIT`, with their files),
  `update_job_status` and `run_cluster_backup`. The MCP client's approval prompt is the control; review
  what it proposes. Whoever can start the process (or `docker run` the image with your env file) has all
  your service credentials.
- **Prompt injection.** Titles, summaries, torrent names and indexer messages come from your services and,
  through them, from the internet. A crafted one could try to steer the model. The chat's read-only tools
  limit what that can achieve there; in an MCP client, keep tool approval on.
- **The first SSH connection.** Trust on first use protects against a host being impersonated *after* first
  contact. To be sure of the first one, compare the fingerprint with
  `ssh-keyscan -t ed25519 <host> | ssh-keygen -lf -`. Use a dedicated, unprivileged SSH user.
- **Your services themselves.** Plex Director acts with the credentials you give it, so it can do whatever
  those credentials allow in Radarr, Sonarr, Prowlarr, SABnzbd, qBittorrent, Tautulli and Plex.
  Vulnerabilities in those apps, and in the Anthropic and TMDb APIs, are outside its control.
- **The host and Docker daemon.** Anyone with access to the machine, the container or the Docker socket is
  outside its protection.

## Hardening facts

- **Container:** the runtime image is distroless (`gcr.io/distroless/nodejs24-debian12`), with no shell,
  package manager, `curl` or `wget`, and base images are pinned by digest. It runs as a **non-root
  user** (UID 65532, `USER` in the Dockerfile) from 1.3.0, and also works with a read-only root filesystem,
  all capabilities dropped and `no-new-privileges`; the README's
  [Read-only and non-root operation](../README.md#read-only-and-non-root-operation) shows how.
  `/app/data` is the only place it writes.
- **HTTP headers:** every response carries a strict `Content-Security-Policy`: scripts, styles, fonts and
  requests only from the dashboard's own origin, nothing inline and no `eval`, images also from `data:` and
  `https:` (posters), no plugins, no `<base>`, and `frame-ancestors 'none'` (the dashboard can't be framed).
  So even markup that slipped into the page couldn't run code or send data elsewhere. Also
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`;
  `X-Powered-By` is off. There is no HSTS: it belongs on the reverse proxy that terminates TLS. Responses are JSON (or images from the two
  artwork proxies); errors are `{"error": "..."}`.
- **Reverse proxies:** `X-Forwarded-For` and `X-Forwarded-Proto` are honoured only from the addresses in
  `WEB_TRUST_PROXY` (`src/web/trustProxy.ts`), and ignored when it is unset. A client can't fake its address
  to get a fresh sign-in limit, or fake HTTPS; values that would trust anyone (`true`, hop counts) are
  refused at start-up.
- **DNS rebinding:** while `WEB_PASSWORD` is unset, requests whose `Host` header is not an IP address,
  `localhost`, a single-word name, a `.local` / `.lan` / `.home.arpa` / `.internal` name or a name listed
  in `WEB_ALLOWED_HOSTS` get a 403 (`src/web/hostCheck.ts`). That stops a web page on a public domain from
  re-pointing its name at the dashboard and reading or changing settings from your browser. With a
  password set, the check is skipped: such a page has no session.
- **A saved secret never follows a URL change:** saving a different URL for a service while leaving its
  key, token or password blank is refused, so the stored secret can't be sent to a new server
  (`src/web/routes/settings.ts`).
- **Dependencies:** locked, audited in CI and updated weekly; see [dependencies.md](dependencies.md).
- **Releases:** images are signed with cosign keyless signing; see
  [verifying-releases.md](verifying-releases.md).

## Dependency and code-scanning policy

**Checked on every change.** Each pull request and push runs `npm audit --audit-level=high` for the
server and the dashboard, GitHub's dependency review (which fails on a new dependency with a moderate or
worse advisory, a malware advisory, or a licence outside the allow-list in
`.github/workflows/dependency-review.yml`), CodeQL's security queries and a secret scan. These are
required checks on `main`, and the branch ruleset also blocks a pull request that introduces a CodeQL
alert of high or critical severity, or an error. Each published image is scanned with Docker Scout; that
scan reports but doesn't block, since a new base-image finding usually needs an upstream rebuild first.

**How fast findings are fixed** is set out in [dependencies.md](dependencies.md): a known vulnerability in
an npm dependency or the base image within
[14 days if critical or high, 60 days if moderate](dependencies.md#policy-for-vulnerabilities-in-dependencies),
and a CodeQL alert of high or critical severity before merging, any other
[fixed or dismissed with a written reason](dependencies.md#policy-for-findings-from-static-analysis-sast). A
dependency with a licence outside the allow-list isn't merged, and is replaced if its licence changes later.

**Before a release** there must be no open critical or high finding of either kind, from `npm audit`,
dependency review, CodeQL or the image scan, unless it is shown not to affect Plex Director and recorded
as below ([before a release](dependencies.md#before-a-release)).

**Not affected.** A false positive is dismissed in GitHub code scanning with the reason written down. A
known vulnerability in a component that Plex Director doesn't use in an affected way is recorded as an
[OpenVEX](https://openvex.dev/) statement in the release notes and in the advisory, if there is one, saying
why it doesn't apply. None is open at the moment.

## Security reviews

The latest review, its scope and what came of it are in
[security-review-2026-10.md](security-review-2026-10.md).

## Using it safely

1. Set `WEB_PASSWORD` to a long, unique password.
2. Keep port 3000 on your LAN; do not forward it from your router.
3. Give each service the least access that works (for example a dedicated qBittorrent user, an
   unprivileged SSH user that can run `docker ps`).
4. Keep the container's default non-root user, and add a read-only filesystem with no capabilities.
5. Keep tool approval on in Claude Desktop, and read what a tool will do before allowing it.
6. Back up `/app/data` somewhere only you can read.
7. Pin a version tag and verify the image signature before upgrading.
