import "./setup.js";
import assert from "node:assert/strict";
import http from "node:http";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { hostnameOf, isAllowedHost } from "../src/web/hostCheck.js";
import { resetDb, startApp } from "./helpers.js";

describe("Host names allowed without a password", () => {
  it("strips ports, brackets, case and a trailing dot", () => {
    assert.equal(hostnameOf("Plex-Director.LAN:3000"), "plex-director.lan");
    assert.equal(hostnameOf("[::1]:3000"), "::1");
    assert.equal(hostnameOf("example.com."), "example.com");
    assert.equal(hostnameOf("fe80::1"), "fe80::1");
  });

  it("accepts names an attacker can't own", () => {
    for (const host of [
      "127.0.0.1:3000",
      "192.168.1.20:3000",
      "[::1]:3000",
      "localhost:3000",
      "nas",
      "plex-director:3000",
      "nas.local",
      "media.lan",
      "box.home.arpa",
      "dash.internal",
      "app.localhost",
    ]) {
      assert.equal(isAllowedHost(host), true, host);
    }
  });

  it("refuses public names, look-alikes and a missing Host", () => {
    for (const host of [
      "attacker.example",
      "evil.com:3000",
      "lan.attacker.com",
      "local.evil.net",
      "192.168.1.20.nip.io",
      "",
    ]) {
      assert.equal(isAllowedHost(host), false, host);
    }
    assert.equal(isAllowedHost(undefined), false);
  });

  it("accepts names listed in WEB_ALLOWED_HOSTS exactly, and * turns the check off", () => {
    assert.equal(isAllowedHost("plex.example.com", ["plex.example.com"]), true);
    assert.equal(isAllowedHost("evil.plex.example.com", ["plex.example.com"]), false);
    assert.equal(isAllowedHost("anything.example", ["*"]), true);
  });
});

describe("DNS-rebinding guard on the dashboard", () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());
  beforeEach(async () => {
    await resetDb();
    delete process.env.WEB_PASSWORD;
    delete process.env.WEB_ALLOWED_HOSTS;
  });
  afterEach(() => {
    delete process.env.WEB_PASSWORD;
    delete process.env.WEB_ALLOWED_HOSTS;
  });

  function request(
    path: string,
    host: string,
    method = "GET",
  ): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    const url = new URL(app.base + path);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method,
          headers: { Host: host, "Content-Type": "application/json" },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        },
      );
      req.on("error", reject);
      req.end(method === "PUT" ? JSON.stringify({ url: "http://attacker" }) : undefined);
    });
  }

  it("refuses the API, settings writes and the page itself for a rebound public name", async () => {
    for (const [path, method] of [
      ["/api/settings", "GET"],
      ["/api/settings/radarr", "PUT"],
      ["/", "GET"],
    ] as const) {
      const res = await request(path, "attacker.example:3000", method);
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.match(res.body, /WEB_ALLOWED_HOSTS/);
    }
  });

  it("still serves the health check, and normal LAN names", async () => {
    assert.equal((await request("/healthz", "attacker.example")).status, 200);
    assert.equal((await request("/api/settings", "192.168.1.20:3000")).status, 200);
    assert.equal((await request("/api/settings", "nas.local:3000")).status, 200);
  });

  it("serves a name listed in WEB_ALLOWED_HOSTS", async () => {
    process.env.WEB_ALLOWED_HOSTS = "plex.example.com, other.example.com";
    assert.equal((await request("/api/settings", "plex.example.com")).status, 200);
    assert.equal((await request("/api/settings", "attacker.example")).status, 403);
  });

  it("skips the check once WEB_PASSWORD is set (login is the protection then)", async () => {
    process.env.WEB_PASSWORD = "pw";
    const res = await request("/api/settings", "plex.example.com");
    assert.equal(res.status, 401);
  });

  it("sends the browser-hardening headers and no X-Powered-By", async () => {
    const res = await request("/healthz", "127.0.0.1");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["content-security-policy"], "frame-ancestors 'none'");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.equal(res.headers["x-powered-by"], undefined);
  });
});
