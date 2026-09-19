import "./setup.js";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { plexClient, prowlarrClient, qbitClient } from "../src/clients.js";
import { db } from "../src/db.js";
import { getSetting, setSetting } from "../src/settings.js";
import { fakeApi, resetDb, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
});
after(() => app.close());
beforeEach(async () => {
  await resetDb();
  delete process.env.WEB_PASSWORD;
});

const get = (path: string, cookie?: string) => fetch(app.base + path, cookie ? { headers: { Cookie: cookie } } : {});
const send = (method: string, path: string, body?: unknown, cookie?: string) =>
  fetch(app.base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("basics", () => {
  it("serves the health check", async () => {
    const res = await get("/healthz");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
  it("answers an unknown API path with a JSON 404, not the SPA page", async () => {
    const res = await get("/api/does-not-exist");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Not found" });
  });
});

describe("settings API", () => {
  it("never returns a secret's value, only whether it is set", async () => {
    setSetting("RADARR_URL", "http://radarr:7878");
    setSetting("RADARR_API_KEY", "super-secret-radarr-key");
    setSetting("PLEX_TOKEN", "super-secret-plex-token");
    const res = await get("/api/settings");
    const raw = await res.text();
    assert.doesNotMatch(raw, /super-secret/);
    const body = JSON.parse(raw);
    assert.equal(body.radarr.url, "http://radarr:7878");
    assert.deepEqual(body.radarr.apiKey, { configured: true });
    assert.deepEqual(body.plex.token, { configured: true });
    assert.deepEqual(body.sonarr.apiKey, { configured: false });
  });

  it("saves trimmed values", async () => {
    const res = await send("PUT", "/api/settings/radarr", { url: "  http://radarr:7878  ", apiKey: "  k  " });
    assert.equal(res.status, 200);
    assert.equal(getSetting("RADARR_URL"), "http://radarr:7878");
    assert.equal(getSetting("RADARR_API_KEY"), "k");
  });

  // Regression: a whitespace-only value used to silently wipe a saved API key.
  it("keeps the saved secret when a blank or whitespace-only one is submitted", async () => {
    setSetting("TMDB_API_KEY", "keep-me");
    await send("PUT", "/api/settings/tmdb", { apiKey: "   " });
    assert.equal(getSetting("TMDB_API_KEY"), "keep-me");
    await send("PUT", "/api/settings/tmdb", { apiKey: "" });
    assert.equal(getSetting("TMDB_API_KEY"), "keep-me");
  });

  it("leaves fields that weren't submitted alone, and lets a URL be cleared", async () => {
    setSetting("SONARR_URL", "http://sonarr");
    setSetting("SONARR_API_KEY", "abc");
    await send("PUT", "/api/settings/sonarr", { url: "" });
    assert.equal(getSetting("SONARR_URL"), "");
    assert.equal(getSetting("SONARR_API_KEY"), "abc");
  });

  it("rejects an unknown service and ignores non-string values", async () => {
    assert.equal((await send("PUT", "/api/settings/nope", { url: "x" })).status, 404);
    setSetting("RADARR_URL", "http://keep");
    await send("PUT", "/api/settings/radarr", { url: 12345 });
    assert.equal(getSetting("RADARR_URL"), "http://keep");
  });
});

describe("Plex image proxy", () => {
  it("rejects anything that isn't a Plex thumb path, before any request is made", async () => {
    const fake = fakeApi(plexClient, () => ({ data: Buffer.from("x") }));
    try {
      for (const bad of ["/etc/passwd", "/library/metadata/1/thumb/1/../../x", "http://evil.example/x.jpg", "/library/metadata/abc/thumb/1", "/library/metadata/1/art/1", ""]) {
        const res = await get(`/api/plex/image?path=${encodeURIComponent(bad)}`);
        assert.equal(res.status, 400, `rejects ${JSON.stringify(bad)}`);
      }
      assert.equal((await get("/api/plex/image")).status, 400);
      assert.equal(fake.calls.length, 0);
    } finally {
      fake.restore();
    }
  });

  it("fetches a resized thumbnail through Plex's transcoder and lets the browser cache it", async () => {
    const fake = fakeApi(plexClient, () => ({ data: Buffer.from("jpegbytes"), headers: { "content-type": "image/jpeg" } }));
    try {
      const res = await get("/api/plex/image?path=%2Flibrary%2Fmetadata%2F91684%2Fthumb%2F1789285096");
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/jpeg");
      assert.match(res.headers.get("cache-control") ?? "", /max-age=86400/);
      assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "jpegbytes");
      assert.equal(fake.calls[0]!.url, "/photo/:/transcode");
      assert.equal(fake.calls[0]!.params.url, "/library/metadata/91684/thumb/1789285096");
    } finally {
      fake.restore();
    }
  });

  it("reports a Plex failure as a 502", async () => {
    const fake = fakeApi(plexClient, () => ({ status: 500 }));
    try {
      assert.equal((await get("/api/plex/image?path=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F1")).status, 502);
    } finally {
      fake.restore();
    }
  });
});

describe("jobs API", () => {
  const insert = (name: string, status: string, done: number, total: number) =>
    db.prepare("INSERT INTO system_jobs (task_name, status, total_items, processed_items, payload) VALUES (?, ?, ?, ?, '[]')").run(name, status, total, done);

  it("returns an empty list when there are no jobs", async () => {
    assert.deepEqual(await (await get("/api/jobs")).json(), { jobs: [] });
  });

  it("returns newest first, in camelCase, with UTC timestamps a browser will read correctly", async () => {
    insert("older", "COMPLETED", 5, 5);
    insert("newer", "RUNNING", 3, 10);
    const { jobs } = (await (await get("/api/jobs")).json()) as { jobs: any[] };
    assert.deepEqual(jobs.map((j) => j.taskName), ["newer", "older"]);
    assert.deepEqual([jobs[0].status, jobs[0].processedItems, jobs[0].totalItems], ["RUNNING", 3, 10]);
    assert.match(jobs[0].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal("payload" in jobs[0], false, "the movie id payload isn't exposed");
  });

  it("returns at most the latest 50", async () => {
    for (let i = 0; i < 60; i++) insert(`job ${i}`, "COMPLETED", 1, 1);
    const { jobs } = (await (await get("/api/jobs")).json()) as { jobs: any[] };
    assert.equal(jobs.length, 50);
    assert.equal(jobs[0].taskName, "job 59");
  });
});

describe("indexers API", () => {
  let fake: ReturnType<typeof fakeApi>;
  afterEach(() => fake?.restore());

  it("returns classified indexers and warnings", async () => {
    fake = fakeApi(prowlarrClient, (req) => {
      if (req.url === "/api/v1/indexer") return { data: [{ id: 1, name: "NZBgeek", protocol: "usenet", priority: 3, enable: true }] };
      if (req.url === "/api/v1/indexerstatus") return { data: [] };
      return { data: [{ type: "warning", source: "X", message: "careful" }] };
    });
    const body = (await (await get("/api/indexers/health")).json()) as any;
    assert.equal(body.indexers[0].state, "healthy");
    assert.deepEqual(body.warnings, [{ type: "warning", source: "X", message: "careful" }]);
  });

  it("returns 502 when Prowlarr is unreachable", async () => {
    fake = fakeApi(prowlarrClient, () => ({ status: 503 }));
    assert.equal((await get("/api/indexers/health")).status, 502);
  });
});

describe("qBittorrent queue API", () => {
  let fake: ReturnType<typeof fakeApi>;
  afterEach(() => fake?.restore());

  it("maps torrents to dashboard rows and flags stalled ones", async () => {
    fake = fakeApi(qbitClient, (req) =>
      req.url.includes("auth/login")
        ? { data: "Ok.", headers: { "set-cookie": ["SID=1; HttpOnly"] } }
        : { data: [{ name: "A", state: "stalledDL", progress: 0.5, dlspeed: 2048, size: 1000, num_seeds: 3 }, { name: "B", state: "downloading", progress: 1, dlspeed: 0, size: 5, num_seeds: 0 }] }
    );
    const { items } = (await (await get("/api/queues/qbittorrent")).json()) as { items: any[] };
    assert.deepEqual(items[0], { name: "A", state: "stalledDL", progress: 0.5, dlspeedKbps: 2, sizeBytes: 1000, seeders: 3, stalled: true });
    assert.equal(items[1].stalled, false);
  });

  it("returns 502 with the reason when qBittorrent rejects the login", async () => {
    fake = fakeApi(qbitClient, () => ({ data: "Fails." }));
    const res = await get("/api/queues/qbittorrent");
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as any).error, /qBittorrent login failed/);
  });
});

describe("chat API", () => {
  it("requires a question", async () => {
    assert.equal((await send("POST", "/api/chat/movies", { question: "   " })).status, 400);
    assert.equal((await send("POST", "/api/chat/movies", {})).status, 400);
  });
  it("reports a missing Anthropic key clearly instead of crashing, even with junk history", async () => {
    const res = await send("POST", "/api/chat/movies", { question: "hi", history: [null, 5, { role: "system" }, { role: "user", text: 3 }] });
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as any).error, /ANTHROPIC_API_KEY is not configured/);
  });
});

describe("dashboard authentication", () => {
  const PASSWORD = "correct horse battery";
  const login = (password: string) => send("POST", "/api/auth/login", { password });
  const cookieFrom = (res: Response) => (res.headers.getSetCookie()[0] ?? "").split(";")[0]!;

  it("is open, and says so, when no password is set", async () => {
    assert.deepEqual(await (await get("/api/auth/status")).json(), { authRequired: false, authenticated: true });
    assert.equal((await get("/api/settings")).status, 200);
  });

  it("locks the API but not the health check, the login endpoints, or the SPA", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    assert.equal((await get("/api/settings")).status, 401);
    assert.equal((await get("/api/jobs")).status, 401);
    assert.equal((await get("/api/does-not-exist")).status, 401, "unknown paths can't be probed");
    assert.equal((await get("/healthz")).status, 200);
    assert.deepEqual(await (await get("/api/auth/status")).json(), { authRequired: true, authenticated: false });
  });

  it("rejects a wrong or missing password without setting a cookie", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    for (const password of ["wrong", ""]) {
      const res = await login(password);
      assert.equal(res.status, 401);
      assert.equal(res.headers.getSetCookie().length, 0);
    }
    assert.equal((await send("POST", "/api/auth/login", {})).status, 401);
  });

  it("logs in with a hardened session cookie that unlocks the API", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    const res = await login(PASSWORD);
    assert.equal(res.status, 200);
    const setCookie = res.headers.getSetCookie()[0]!;
    assert.match(setCookie, /^pd_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.doesNotMatch(setCookie, /Secure/i, "plain HTTP: not marked Secure");

    const cookie = cookieFrom(res);
    assert.equal((await get("/api/settings", cookie)).status, 200);
    assert.deepEqual(await (await get("/api/auth/status", cookie)).json(), { authRequired: true, authenticated: true });
  });

  it("marks the cookie Secure when the request arrived over HTTPS", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    const res = await fetch(app.base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.match(res.headers.getSetCookie()[0]!, /Secure/i);
  });

  it("rejects a tampered cookie, and everyone is signed out when the password changes", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    const cookie = cookieFrom(await login(PASSWORD));
    assert.equal((await get("/api/settings", cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A"))).status, 401);
    process.env.WEB_PASSWORD = "a new password";
    assert.equal((await get("/api/settings", cookie)).status, 401);
  });

  it("logout expires the cookie", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    const res = await send("POST", "/api/auth/logout", {});
    assert.equal(res.status, 200);
    assert.match(res.headers.getSetCookie()[0]!, /pd_session=;.*Expires=Thu, 01 Jan 1970/);
  });

  it("the Plex image proxy works for an <img> tag carrying the session cookie, and not without it", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    const fake = fakeApi(plexClient, () => ({ data: Buffer.from("x"), headers: { "content-type": "image/jpeg" } }));
    try {
      const path = "/api/plex/image?path=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F1";
      assert.equal((await get(path)).status, 401);
      assert.equal((await get(path, cookieFrom(await login(PASSWORD)))).status, 200);
    } finally {
      fake.restore();
    }
  });

  // Keep this last: the limiter is process-wide and counts failed attempts.
  it("rate-limits failed logins, so the password can't be guessed at speed", async () => {
    process.env.WEB_PASSWORD = PASSWORD;
    let blockedAt = 0;
    for (let attempt = 1; attempt <= 14 && !blockedAt; attempt++) {
      if ((await login(`guess ${attempt}`)).status === 429) blockedAt = attempt;
    }
    assert.ok(blockedAt > 0 && blockedAt <= 11, `blocked by attempt ${blockedAt}`);
    assert.equal((await login(PASSWORD)).status, 429, "even the right password is refused while blocked");
  });
});
