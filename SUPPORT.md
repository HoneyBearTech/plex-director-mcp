# Support

Plex Director is maintained by one person in their own time (see [GOVERNANCE.md](GOVERNANCE.md)), so this
is a best-effort policy, not a contract.

## Getting help

- **Setting it up**: the [README](README.md) covers installing with Docker or Node, every environment
  variable, the dashboard and each MCP tool. Two things that trip people up are covered there too: inside the
  container, `localhost` is the container and not your server, and once a service is saved on the Settings
  page, that value wins over the environment variable.
- **Questions, bugs and feature ideas**: [GitHub Issues](https://github.com/HoneyBearTech/plex-director-mcp/issues).
  Say which version you run (the image tag, or the commit), how you run it (Docker Compose, Docker CLI,
  Claude Desktop through Docker, or Node), and what you expected. **Never paste API keys, tokens or passwords**,
  and redact them from logs and screenshots.
- **Security vulnerabilities**: never in a public issue; see [SECURITY.md](SECURITY.md).

Problems with Plex, Radarr, Sonarr, Prowlarr, SABnzbd, qBittorrent, Tautulli or TMDb themselves belong with
those projects; this one can only help with how Plex Director talks to them.

## Which versions are supported, and for how long

| Version | Supported with | Until |
| --- | --- | --- |
| The [latest release](https://github.com/HoneyBearTech/plex-director-mcp/releases/latest) | bug fixes and security fixes | the next release is published |
| An older release | nothing | it stopped being supported when the next release came out |
| `main` (the `latest` image tag) | bug fixes and security fixes | always (it's where fixes land first) |

- A fix is released as a new version (a patch release such as 1.1.1 for fixes only), never applied to an
  older release.
- **A release stops receiving security updates the moment the next release is published.** The release
  notes and [CHANGELOG.md](CHANGELOG.md) say what changed. Updating is described in
  [Updating](README.md#updating) in the README; your settings and job history live in the data volume, so
  they carry over.
- Versions follow [Semantic Versioning](https://semver.org/): a patch release (1.1.1) only fixes things, a
  minor release (1.2.0) adds features, and a major release (2.0.0) may change behaviour you rely on. Anything
  that needs a step when upgrading is called out in the changelog.
- If a supported line will end differently (for example a 1.x line kept alive after 2.0), it will be
  announced in the release notes and in this table first.

Images stay available on Docker Hub and GitHub Container Registry after their support ends, so existing
setups keep working, but they won't get fixes: run the latest release.
