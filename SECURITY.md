# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities using [GitHub's private vulnerability reporting](https://github.com/HoneyBearTech/plex-director-mcp/security/advisories/new) rather than a public issue.

Include what you found, how to reproduce it (a minimal setup, the requests, tool calls or chat questions involved), which version or image digest you tested, and what an attacker gains. Never include your real API keys or tokens; redact them from logs. If you'd like to be credited under a particular name, or not at all, say so.

## How reports are handled

This is a personal project maintained by one person (see [GOVERNANCE.md](GOVERNANCE.md)), so these are targets rather than a contractual SLA:

1. **Acknowledge** the report within 7 days.
2. **Triage** it: reproduce the problem, decide whether it is a vulnerability in Plex Director (see "Scope" below), and agree its severity with you. If it isn't a vulnerability, you'll get an explanation, and the report may move to a public issue with your agreement.
3. **Fix** it privately in a [GitHub security advisory](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/about-repository-security-advisories), with a regression test, and invite you to review the fix if you want to.
4. **Release** the fix, then publish the advisory (requesting a CVE where it applies) with the affected and fixed versions and any workaround. The aim is to release fixes for critical and high-severity issues within 30 days of the report and others within 90 days, and to keep you updated at least every 14 days until then.
5. **Credit** the reporter in the advisory and the release notes, unless you ask to stay anonymous.

Please keep the details private until the advisory is published, or for 90 days after your report if no fix has been released by then; if you need a different timeline, say so in the report.

## Supported Versions

Only the most recent Docker image (`latest` tag) and the most recent tagged release are supported. Older tagged versions do not receive security patches. Details are in [SUPPORT.md](SUPPORT.md).

## Published vulnerabilities

Fixed vulnerabilities in Plex Director are published as [GitHub security advisories](https://github.com/HoneyBearTech/plex-director-mcp/security/advisories) (with a CVE where one applies), naming the affected and fixed versions, how to tell whether you're affected, and how to fix or work around it, and they're listed in the [changelog](CHANGELOG.md) and release notes. How vulnerabilities in Plex Director's dependencies are handled is described in [docs/dependencies.md](docs/dependencies.md).

## Scope

This server is designed to run locally or on a trusted home network, authenticated against your own Servarr/Plex stack via API keys you control. It is not designed or tested to be exposed to the public internet.

What Plex Director does and doesn't protect against is described in [docs/security.md](docs/security.md) (its security requirements), and the reasoning behind it in [docs/assurance-case.md](docs/assurance-case.md) (threat model, trust boundaries and the defences against common weaknesses). Read them before you deploy or report.

In scope: bypassing the dashboard login, exposing stored API keys or tokens (in responses, logs or the chat), making the server reach hosts or URLs it shouldn't (for example through the image proxy), command injection through SSH host monitoring, and media metadata or other service data that makes the chat or an MCP client take an action the user didn't ask for. Expected behaviour, not a vulnerability: anything someone who already has the dashboard password or controls the MCP client can do through the tools as documented.
