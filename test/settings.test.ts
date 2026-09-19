import "./setup.js";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSetting, isConfigured, seedSettingsFromEnv, setSetting, SETTINGS_KEYS } from "../src/settings.js";
import { resetDb } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  for (const key of SETTINGS_KEYS) delete process.env[key];
});

// The gotcha in dev-gotchas.md: once a key has a row in the database, .env is
// never consulted again for it.
describe("settings precedence", () => {
  it("falls back to .env (trimmed) when the database has no row", () => {
    process.env.RADARR_URL = "  http://radarr:7878  ";
    assert.equal(getSetting("RADARR_URL"), "http://radarr:7878");
  });
  it("returns an empty string when neither source has a value", () => {
    assert.equal(getSetting("SONARR_URL"), "");
  });
  it("database value overrides .env", () => {
    process.env.RADARR_URL = "http://from-env";
    setSetting("RADARR_URL", "http://from-db");
    assert.equal(getSetting("RADARR_URL"), "http://from-db");
  });
  it("a saved empty value still overrides .env (the silent no-op editing .env)", () => {
    process.env.RADARR_URL = "http://from-env";
    setSetting("RADARR_URL", "");
    assert.equal(getSetting("RADARR_URL"), "");
  });
});

describe("seedSettingsFromEnv", () => {
  it("copies non-empty .env values into the database", () => {
    process.env.TMDB_API_KEY = " key123 ";
    seedSettingsFromEnv();
    delete process.env.TMDB_API_KEY;
    assert.equal(getSetting("TMDB_API_KEY"), "key123");
  });
  it("skips blank values and never overwrites an existing row", () => {
    process.env.SONARR_URL = "   ";
    process.env.RADARR_URL = "http://from-env";
    setSetting("RADARR_URL", "http://saved");
    seedSettingsFromEnv();
    delete process.env.RADARR_URL;
    delete process.env.SONARR_URL;
    assert.equal(getSetting("RADARR_URL"), "http://saved");
    assert.equal(getSetting("SONARR_URL"), "");
  });
});

describe("isConfigured", () => {
  it("is true only when the service URL is set", () => {
    assert.equal(isConfigured("PLEX"), false);
    setSetting("PLEX_URL", "http://plex:32400");
    assert.equal(isConfigured("PLEX"), true);
  });
});
