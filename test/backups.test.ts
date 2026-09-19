import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { prowlarrClient, radarrClient, sonarrClient } from "../src/clients.js";
import { setSetting } from "../src/settings.js";
import { runServarrBackups } from "../src/backups.js";
import { fakeApi, resetDb, type FakeReply, type RecordedRequest } from "./helpers.js";

const FAST = { pollMs: 1, timeoutMs: 200 };
const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");

type AppFake = {
  // statuses the command reports on each poll, in order (the trigger response is "queued")
  polls: string[];
  backups: Array<{ name: string; time: string; size?: number }>;
  message?: string;
  triggerFails?: boolean;
};

let fakes: Array<ReturnType<typeof fakeApi>> = [];
const calls: Record<string, RecordedRequest[]> = {};

function app(client: typeof radarrClient, label: string, config: AppFake) {
  const remaining = [...config.polls];
  calls[label] = [];
  const f = fakeApi(client, (req): FakeReply => {
    calls[label]!.push(req);
    if (req.method === "post" && req.url.endsWith("/command")) {
      if (config.triggerFails) return { status: 500 };
      return { status: 201, data: { id: 42, name: "Backup", status: "queued", queued: iso(0), started: null } };
    }
    if (req.method === "get" && req.url.endsWith("/command/42")) {
      const status = remaining.shift() ?? "completed";
      return { data: { id: 42, status, queued: iso(0), started: iso(0), message: config.message ?? null } };
    }
    if (req.url.endsWith("/system/backup")) return { data: config.backups };
    return { status: 404 };
  });
  fakes.push(f);
}

const fresh = (name: string, size = 27_600_000) => ({ name, time: iso(2_000), size });
const stale = (name: string) => ({ name, time: iso(-7 * 24 * 3_600_000), size: 27_600_000 });

beforeEach(async () => {
  await resetDb();
  for (const key of ["RADARR_URL", "SONARR_URL", "PROWLARR_URL"] as const) setSetting(key, "http://app");
});
afterEach(() => {
  fakes.forEach((f) => f.restore());
  fakes = [];
});

describe("runServarrBackups", () => {
  it("triggers a backup on each configured app, waits, and reports the new file", async () => {
    app(radarrClient, "radarr", { polls: ["started", "completed"], backups: [stale("radarr_old.zip"), fresh("radarr_new.zip")] });
    app(sonarrClient, "sonarr", { polls: [], backups: [fresh("sonarr_new.zip", 78_200_000)] });
    app(prowlarrClient, "prowlarr", { polls: [], backups: [fresh("prowlarr_new.zip", 3_000_000)] });

    const { text, isError } = await runServarrBackups(FAST);
    assert.equal(isError, false);
    assert.match(text, /✅ Radarr: backup completed: radarr_new\.zip \(27\.6 MB, /);
    assert.match(text, /✅ Sonarr: backup completed: sonarr_new\.zip \(78\.2 MB/);
    assert.match(text, /✅ Prowlarr: backup completed: prowlarr_new\.zip \(3\.0 MB/);
    assert.match(text, /does not copy it anywhere/);
  });

  it("uses the right API version for each app (Prowlarr is v1, the others v3) and posts a Backup command", async () => {
    app(radarrClient, "radarr", { polls: [], backups: [fresh("r.zip")] });
    app(sonarrClient, "sonarr", { polls: [], backups: [fresh("s.zip")] });
    app(prowlarrClient, "prowlarr", { polls: [], backups: [fresh("p.zip")] });
    await runServarrBackups(FAST);
    assert.equal(calls.radarr![0]!.url, "/api/v3/command");
    assert.equal(calls.sonarr![0]!.url, "/api/v3/command");
    assert.equal(calls.prowlarr![0]!.url, "/api/v1/command");
    assert.deepEqual(calls.prowlarr![0]!.body, { name: "Backup" });
    assert.ok(calls.prowlarr!.some((c) => c.url === "/api/v1/system/backup"));
  });

  it("keeps polling while the command is queued or started", async () => {
    app(radarrClient, "radarr", { polls: ["queued", "started", "started", "completed"], backups: [fresh("r.zip")] });
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    await runServarrBackups(FAST);
    assert.equal(calls.radarr!.filter((c) => c.url === "/api/v3/command/42").length, 4);
  });

  it("skips apps that aren't configured, without calling them", async () => {
    app(radarrClient, "radarr", { polls: [], backups: [fresh("r.zip")] });
    app(sonarrClient, "sonarr", { polls: [], backups: [] });
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    const { text, isError } = await runServarrBackups(FAST);
    assert.equal(isError, false);
    assert.match(text, /⏭️ Sonarr: not configured, skipped/);
    assert.match(text, /⏭️ Prowlarr: not configured, skipped/);
    assert.equal(calls.sonarr!.length, 0);
  });

  it("is an error when nothing is configured", async () => {
    setSetting("RADARR_URL", "");
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    const { text, isError } = await runServarrBackups(FAST);
    assert.equal(isError, true);
    assert.match(text, /None of Radarr, Sonarr or Prowlarr is configured/);
  });

  it("reports a failed backup with the app's message", async () => {
    app(radarrClient, "radarr", { polls: ["failed"], backups: [], message: "Disk full" });
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    const { text, isError } = await runServarrBackups(FAST);
    assert.equal(isError, true);
    assert.match(text, /❌ Radarr: the backup failed: Disk full\./);
  });

  it("warns when the command says completed but no new backup file appeared", async () => {
    app(radarrClient, "radarr", { polls: [], backups: [stale("radarr_last_week.zip")] });
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    const { text } = await runServarrBackups(FAST);
    assert.match(text, /⚠️ Radarr: the backup command finished, but no new file appeared - the newest backup is still radarr_last_week\.zip/);
    assert.doesNotMatch(text, /✅/);
  });

  it("warns when the app lists no backups at all", async () => {
    app(radarrClient, "radarr", { polls: [], backups: [] });
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    assert.match((await runServarrBackups(FAST)).text, /⚠️ Radarr: the backup finished, but Radarr lists no backup files/);
  });

  it("gives up waiting after the timeout instead of hanging, and says it may still finish", async () => {
    app(radarrClient, "radarr", { polls: Array(10_000).fill("started"), backups: [] });
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    const started = Date.now();
    const { text, isError } = await runServarrBackups({ pollMs: 1, timeoutMs: 60 });
    assert.ok(Date.now() - started < 2_000, "returned promptly");
    assert.equal(isError, false, "a slow backup is a warning, not a failure");
    assert.match(text, /⚠️ Radarr: the backup was started but hadn't finished after 0s\. Large databases can take over a minute/);
  });

  it("one app failing doesn't stop or hide the others", async () => {
    app(radarrClient, "radarr", { polls: [], backups: [fresh("r.zip")] });
    app(sonarrClient, "sonarr", { polls: [], backups: [], triggerFails: true });
    setSetting("PROWLARR_URL", "");
    const { text, isError } = await runServarrBackups(FAST);
    assert.equal(isError, false, "something succeeded");
    assert.match(text, /✅ Radarr/);
    assert.match(text, /❌ Sonarr: /);
  });

  it("picks the newest backup by time, not by list order", async () => {
    app(radarrClient, "radarr", { polls: [], backups: [fresh("radarr_newest.zip"), stale("radarr_a.zip"), { name: "radarr_b.zip", time: iso(-1_000), size: 1 }] });
    setSetting("SONARR_URL", "");
    setSetting("PROWLARR_URL", "");
    assert.match((await runServarrBackups(FAST)).text, /radarr_newest\.zip/);
  });
});
