import "./setup.js";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { db } from "../src/db.js";
import { encryptionKeyFromEnv, isSealed, open, seal } from "../src/secretBox.js";
import {
  getSetting,
  prepareStoredSecrets,
  SECRET_SETTINGS_KEYS,
  setSetting,
  type SettingsKey,
} from "../src/settings.js";
import { resetDb } from "./helpers.js";

const KEY = crypto.randomBytes(32);
const OTHER_KEY = crypto.randomBytes(32);
const useKey = (key: Buffer | null) => {
  if (key) process.env.SETTINGS_ENCRYPTION_KEY = key.toString("base64");
  else delete process.env.SETTINGS_ENCRYPTION_KEY;
};
const stored = (key: string) =>
  (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)
    ?.value;
const writeRaw = (key: string, value: string) =>
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);

beforeEach(resetDb);
afterEach(() => {
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  delete process.env.SETTINGS_ENCRYPTION_RESET;
});

describe("secretBox", () => {
  it("round-trips, with a fresh IV every time", () => {
    const a = seal("abc123", "PLEX_TOKEN", KEY);
    const b = seal("abc123", "PLEX_TOKEN", KEY);
    assert.ok(isSealed(a));
    assert.notEqual(a, b);
    assert.ok(!a.includes("abc123"));
    assert.equal(open(a, "PLEX_TOKEN", KEY), "abc123");
    assert.equal(open(seal("", "PLEX_TOKEN", KEY), "PLEX_TOKEN", KEY), "");
  });

  it("refuses another key, another setting's ciphertext, and any change", () => {
    const sealed = seal("abc123", "PLEX_TOKEN", KEY);
    assert.throws(() => open(sealed, "PLEX_TOKEN", OTHER_KEY));
    assert.throws(() => open(sealed, "SONARR_API_KEY", KEY), "bound to its setting's name");
    // Flip one bit in each part (IV, tag, ciphertext): every change must be caught.
    const raw = Buffer.from(sealed.slice("enc:v1:".length), "base64url");
    for (const at of [0, 12, raw.length - 1]) {
      const tampered = Buffer.from(raw);
      tampered[at] = (tampered[at] ?? 0) ^ 1;
      assert.throws(
        () => open(`enc:v1:${tampered.toString("base64url")}`, "PLEX_TOKEN", KEY),
        `byte ${at}`,
      );
    }
    assert.throws(() => open("enc:v1:AAAA", "PLEX_TOKEN", KEY), /truncated/);
  });

  it("reads the key as base64 or hex, exactly 32 bytes", () => {
    assert.equal(encryptionKeyFromEnv(undefined), null);
    assert.equal(encryptionKeyFromEnv("  "), null);
    assert.deepEqual(encryptionKeyFromEnv(KEY.toString("base64")), KEY);
    assert.deepEqual(encryptionKeyFromEnv(KEY.toString("base64url")), KEY);
    assert.deepEqual(encryptionKeyFromEnv(KEY.toString("hex")), KEY);
    for (const bad of [
      "short",
      crypto.randomBytes(16).toString("base64"),
      "x".repeat(44),
      "not base64!",
    ])
      assert.throws(() => encryptionKeyFromEnv(bad), /openssl rand -base64 32/, bad);
  });
});

describe("settings encryption", () => {
  it("stores credentials encrypted when a key is set, and reads them back", () => {
    useKey(KEY);
    setSetting("RADARR_API_KEY", "radarr-secret");
    setSetting("RADARR_URL", "http://radarr:7878");
    assert.ok(isSealed(stored("RADARR_API_KEY")!));
    assert.ok(!stored("RADARR_API_KEY")!.includes("radarr-secret"));
    assert.equal(getSetting("RADARR_API_KEY"), "radarr-secret");
    assert.equal(stored("RADARR_URL"), "http://radarr:7878", "a URL is not a secret");
    setSetting("RADARR_API_KEY", "");
    assert.equal(stored("RADARR_API_KEY"), "", "cleared stays empty");
  });

  it("stores them as before without a key", () => {
    setSetting("PLEX_TOKEN", "plex-secret");
    assert.equal(stored("PLEX_TOKEN"), "plex-secret");
    assert.equal(prepareStoredSecrets().keySet, false);
  });

  it("covers every credential field and nothing else", () => {
    assert.deepEqual([...SECRET_SETTINGS_KEYS].sort(), [
      "PLEX_TOKEN",
      "PROWLARR_API_KEY",
      "QBITTORRENT_PASS",
      "RADARR_API_KEY",
      "SABNZBD_API_KEY",
      "SONARR_API_KEY",
      "TAUTULLI_API_KEY",
      "TMDB_API_KEY",
    ]);
  });
});

describe("prepareStoredSecrets", () => {
  it("encrypts credentials saved before the key was set, once", () => {
    writeRaw("SONARR_API_KEY", "sonarr-secret");
    writeRaw("TMDB_API_KEY", "");
    writeRaw("SONARR_URL", "http://sonarr:8989");
    useKey(KEY);
    assert.deepEqual(prepareStoredSecrets(), { keySet: true, encrypted: 1, forgotten: [] });
    assert.ok(isSealed(stored("SONARR_API_KEY")!));
    assert.equal(stored("SONARR_URL"), "http://sonarr:8989");
    assert.equal(getSetting("SONARR_API_KEY"), "sonarr-secret");
    assert.equal(prepareStoredSecrets().encrypted, 0, "already done");
  });

  it("stops start-up, naming the settings but no values, when the key is missing", () => {
    useKey(KEY);
    setSetting("PLEX_TOKEN", "plex-secret");
    setSetting("QBITTORRENT_PASS", "qbit-secret");
    useKey(null);
    assert.throws(
      () => prepareStoredSecrets(),
      (error: Error) =>
        /2 saved credentials are encrypted \(QBITTORRENT_PASS, PLEX_TOKEN\), but SETTINGS_ENCRYPTION_KEY is not set/.test(
          error.message,
        ) && !/plex-secret|qbit-secret/.test(error.message),
    );
  });

  it("stops start-up when the key is not the one they were saved with", () => {
    useKey(KEY);
    setSetting("PLEX_TOKEN", "plex-secret");
    useKey(OTHER_KEY);
    assert.throws(
      () => prepareStoredSecrets(),
      /is not the key it was saved with.*delete it, then enter it again/,
    );
    assert.equal(getSetting("PLEX_TOKEN"), "", "an unreadable value is never passed on");
  });

  it("with SETTINGS_ENCRYPTION_RESET=1, deletes what it can't read and keeps the rest", () => {
    useKey(OTHER_KEY);
    setSetting("SABNZBD_API_KEY", "readable");
    useKey(KEY);
    setSetting("PLEX_TOKEN", "lost");
    useKey(OTHER_KEY);
    process.env.SETTINGS_ENCRYPTION_RESET = "1";
    assert.deepEqual(prepareStoredSecrets(), {
      keySet: true,
      encrypted: 0,
      forgotten: ["PLEX_TOKEN"] as SettingsKey[],
    });
    assert.equal(stored("PLEX_TOKEN"), undefined);
    assert.equal(getSetting("SABNZBD_API_KEY"), "readable");
  });

  it("refuses a malformed key rather than running without encryption", () => {
    process.env.SETTINGS_ENCRYPTION_KEY = "too-short";
    assert.throws(() => prepareStoredSecrets(), /32 random bytes/);
  });
});
