import "./setup.js";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import axios from "axios";
import { assertIsolated } from "./helpers.js";

// The canary. If any of these fail, the suite is NOT isolated and must not be
// run: it could write to the real database or talk to real services.
describe("test isolation", () => {
  it("uses a throwaway database, never data/plex_director.db", async () => {
    assertIsolated();
    const { db } = await import("../src/db.js");
    const dbFile = db.name;
    assert.ok(dbFile.startsWith(os.tmpdir()), `database is in the temp dir (${dbFile})`);
    assert.match(path.basename(path.dirname(dbFile)), /^plex-director-test-/);
    assert.doesNotMatch(dbFile, /[\\/]data[\\/]plex_director\.db$/);
  });

  it("does not load the developer's .env", () => {
    assert.equal(process.env.PLEX_DIRECTOR_SKIP_DOTENV, "1");
  });

  it("has no service credentials or webhooks in the environment", () => {
    const leaked = Object.keys(process.env).filter((k) => /^(RADARR|SONARR|PROWLARR|SABNZBD|QBITTORRENT|TAUTULLI|PLEX|TMDB|UBUNTU|SSH|DISCORD|WEB|ANTHROPIC|JOB_RUNNER|BACKUP|CLUSTER)_/.test(k) && k !== "PLEX_DIRECTOR_SKIP_DOTENV" && k !== "PLEX_DIRECTOR_DB_PATH");
    assert.deepEqual(leaked, []);
  });

  it("blocks network access unless a test installs a fake", async () => {
    await assert.rejects(axios.get("https://example.com/"), /Network access is disabled in tests/);
    await assert.rejects(axios.create().post("http://127.0.0.1:1/x", {}), /Network access is disabled in tests/);
  });

  it("refuses to run destructive helpers against a non-test database", () => {
    const saved = process.env.PLEX_DIRECTOR_DB_PATH;
    try {
      process.env.PLEX_DIRECTOR_DB_PATH = path.join(process.cwd(), "data", "plex_director.db");
      assert.throws(() => assertIsolated(), /Refusing to touch a database that isn't a test one/);
      delete process.env.PLEX_DIRECTOR_DB_PATH;
      assert.throws(() => assertIsolated(), /Refusing/);
    } finally {
      process.env.PLEX_DIRECTOR_DB_PATH = saved!;
    }
  });
});
