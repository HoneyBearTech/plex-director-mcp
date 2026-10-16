# Security review, October 2026

A review of Plex Director's security requirements and trust boundaries, carried out on 15 and 16 October 2026,
and what came of it. It covers releases up to 1.4.0 and the changes released in 1.5.0.

## Scope and method

- **Scope:** the whole application as it is deployed: the MCP server over stdio, the dashboard and its HTTP API,
  the Query chat and its tool calls, the settings store and credentials, SSH host monitoring, the container
  image, and the CI and release pipeline. It was measured against the requirements in
  [security.md](security.md) and the trust boundaries in the [assurance case](assurance-case.md).
- **Method:** a manual review of the code and configuration, made with an AI coding assistant and directed by
  the maintainer, who confirmed each finding in the code, rated it and decided the fix. Tools supported it
  (CodeQL, Docker Scout, `npm audit`, the test suite), but the findings below came from reading the code
  and design. **It is not an independent audit.**
- **Severity** is rated for the intended deployment: a self-hosted service on a trusted LAN, possibly with no
  dashboard password.

## Findings

| # | Finding | Severity | Fixed in |
| --- | --- | --- | --- |
| 1 | Saving a new service URL with the secret left blank kept the stored key, which was then sent to the new host | High (no password) | 1.2.0 |
| 2 | No `Host` check: a DNS-rebinding page could reach a dashboard with no password | High (no password) | 1.2.0 |
| 3 | No browser hardening headers; later, no full Content-Security-Policy | Medium | 1.2.0 (headers), 1.5.0 (CSP) |
| 4 | No reverse-proxy trust setting: all clients shared one rate limit, and any client could claim HTTPS | Medium | 1.4.0 |
| 5 | "Trust new key" let anyone on the network re-pin a host's SSH key when no password was set | Medium | 1.4.0 |
| 6 | The Query chat passed the model's tool arguments to handlers without schema validation | Medium | 1.3.0 |
| 7 | The movie-status poster was downloaded from any URL in Radarr's metadata, with no limits | Medium | 1.4.0 |
| 8 | The image proxies passed the upstream content type on and allowed shared caching | Low | 1.4.0 |
| 9 | Any job status could change to any other (a cancelled job could be revived); no batch-size cap | Low | 1.4.0 |
| 10 | The torrent hash was put into a form body unencoded | Low | 1.4.0 |
| 11 | SSH probes had no overall deadline and no output limit | Low | 1.4.0 |
| 12 | Service credentials were stored in plain text | Medium | 1.4.0 (encryption at rest, opt-in) |
| 13 | The container ran as root by default | Medium | 1.3.0 |
| 14 | `PURGE_STALLED` said releases were blocklisted when they weren't | Low | 1.4.0 |
| 15 | `PURGE_STALLED` deleted whatever was stalled at the time instead of a list the user had seen | Medium | 1.5.0 |
| 16 | The 1.4.0 image's base had 3 critical and 27 high known vulnerabilities (distroless Debian 12 had stopped being rebuilt) | High | 1.5.0 |

Each fix came with tests, and the [changelog](../CHANGELOG.md) describes it under the release that shipped it.

## Accepted, not changed

- **Plain HTTP on the LAN.** The dashboard serves HTTP and talks to LAN services over whatever scheme they
  use; HTTPS is meant to come from a reverse proxy ([installing.md](installing.md#keep-the-port-off-the-internet)).
- **Encryption at rest is opt-in.** Requiring `SETTINGS_ENCRYPTION_KEY` would stop existing installs; without
  it, start-up warns.
- **One maintainer.** There is no second reviewer of changes yet ([GOVERNANCE.md](../GOVERNANCE.md)).
- **The image scan doesn't block publishing.** It runs after an image is pushed, and a new base-image
  finding usually needs an upstream rebuild first.

## Next review

Within a year, or sooner after a change to authentication, credential handling, the tools that change
things, or the trust boundaries.
