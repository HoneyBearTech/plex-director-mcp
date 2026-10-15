import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { isAuthEnabled } from "./auth.js";

// DNS-rebinding guard for a dashboard with no password.
//
// A web page on attacker.example can re-point its own hostname at the
// dashboard's LAN address; the browser then treats the dashboard as same-origin
// with that page and lets it read and change settings. What gives it away is
// the Host header: it still says attacker.example. So, while WEB_PASSWORD is
// unset, only Host names an attacker can't own are accepted: IP addresses,
// localhost, single-label names (nas, plex-director) and private-use domains.
// Anything else, such as a reverse proxy's public name, must be listed in
// WEB_ALLOWED_HOSTS (comma-separated; "*" turns the check off). With
// WEB_PASSWORD set the check is skipped: a rebinding page has no session
// cookie and can't log in.

const PRIVATE_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".localdomain", ".localhost"];

// The hostname part of a Host header, lower-cased, without port or brackets.
export function hostnameOf(hostHeader: string): string {
  let host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  const colon = host.lastIndexOf(":");
  if (colon !== -1 && host.indexOf(":") === colon) host = host.slice(0, colon);
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

export function allowedHostsFromEnv(): string[] {
  return (process.env.WEB_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => hostnameOf(h))
    .filter((h) => h !== "");
}

export function isAllowedHost(hostHeader: string | undefined, extra: string[] = []): boolean {
  if (extra.includes("*")) return true;
  if (!hostHeader) return false;
  const host = hostnameOf(hostHeader);
  if (host === "") return false;
  if (net.isIP(host) !== 0) return true;
  if (host === "localhost" || !host.includes(".")) return true;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return extra.includes(host);
}

export function requireAllowedHost(req: Request, res: Response, next: NextFunction) {
  if (isAuthEnabled() || isAllowedHost(req.headers.host, allowedHostsFromEnv())) {
    next();
    return;
  }
  const host = hostnameOf(req.headers.host ?? "");
  res
    .status(403)
    .type("text/plain")
    .send(
      `Plex Director refused this request: "${host}" is not an allowed host name for a dashboard without a password. ` +
        `Set WEB_PASSWORD (recommended), or add the name to WEB_ALLOWED_HOSTS, then restart.`
    );
}
