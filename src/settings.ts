import { db } from "./db.js";

// Every setting the web UI's Settings page can configure, grouped by
// service. Keys match the .env variable names they can override.
export const SETTINGS_KEYS = [
  "SONARR_URL",
  "SONARR_API_KEY",
  "RADARR_URL",
  "RADARR_API_KEY",
  "PROWLARR_URL",
  "PROWLARR_API_KEY",
  "SABNZBD_URL",
  "SABNZBD_API_KEY",
  "QBITTORRENT_URL",
  "QBITTORRENT_USER",
  "QBITTORRENT_PASS",
  "TAUTULLI_URL",
  "TAUTULLI_API_KEY",
  "TMDB_API_KEY",
  "UBUNTU_HOSTS",
  "SSH_USER",
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

const getStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const setStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

// DB value wins once set; .env is only ever a fallback/seed, never
// re-consulted after a key has been saved.
export function getSetting(key: SettingsKey): string {
  const row = getStmt.get(key) as { value: string } | undefined;
  if (row !== undefined) {
    return row.value ?? "";
  }
  return process.env[key]?.trim() ?? "";
}

export function setSetting(key: SettingsKey, value: string): void {
  setStmt.run(key, value);
}

// Copies each key's current .env value into the DB the first time the
// server ever boots, so "DB overrides env" has something to seed from
// instead of starting every service blank even when .env is fully filled in.
export function seedSettingsFromEnv(): void {
  for (const key of SETTINGS_KEYS) {
    const row = getStmt.get(key) as { value: string } | undefined;
    if (row === undefined) {
      const envValue = process.env[key]?.trim();
      if (envValue) {
        setSetting(key, envValue);
      }
    }
  }
}

const SERVICE_URL_KEYS = {
  SONARR: "SONARR_URL",
  RADARR: "RADARR_URL",
  PROWLARR: "PROWLARR_URL",
  SABNZBD: "SABNZBD_URL",
  QBITTORRENT: "QBITTORRENT_URL",
  TAUTULLI: "TAUTULLI_URL",
} as const;

export function isConfigured(service: keyof typeof SERVICE_URL_KEYS): boolean {
  return getSetting(SERVICE_URL_KEYS[service]) !== "";
}
