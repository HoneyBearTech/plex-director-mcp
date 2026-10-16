import { db } from "./db.js";
import { encryptionKeyFromEnv, isSealed, open, seal } from "./secretBox.js";

// Every setting the web UI's Settings page can configure, grouped by
// service. Keys match the .env variable names they can override.
export const SETTINGS_KEYS = [
  "SONARR_URL",
  "SONARR_API_KEY",
  "RADARR_URL",
  "RADARR_API_KEY",
  "RADARR_DEFAULT_QUALITY_PROFILE",
  "PROWLARR_URL",
  "PROWLARR_API_KEY",
  "SABNZBD_URL",
  "SABNZBD_API_KEY",
  "QBITTORRENT_URL",
  "QBITTORRENT_USER",
  "QBITTORRENT_PASS",
  "TAUTULLI_URL",
  "TAUTULLI_API_KEY",
  "PLEX_URL",
  "PLEX_TOKEN",
  "PLEX_SKIP_LIBRARIES",
  "TMDB_API_KEY",
  "UBUNTU_HOSTS",
  "SSH_USER",
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

// The settings that are credentials. With SETTINGS_ENCRYPTION_KEY set they are
// stored encrypted (src/secretBox.ts); everything else stays readable.
export const SECRET_SETTINGS_KEYS: ReadonlySet<SettingsKey> = new Set<SettingsKey>([
  "SONARR_API_KEY",
  "RADARR_API_KEY",
  "PROWLARR_API_KEY",
  "SABNZBD_API_KEY",
  "QBITTORRENT_PASS",
  "TAUTULLI_API_KEY",
  "PLEX_TOKEN",
  "TMDB_API_KEY",
]);

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
    return readStored(key, row.value ?? "");
  }
  return process.env[key]?.trim() ?? "";
}

// prepareStoredSecrets stops start-up while any encrypted value can't be
// opened, so the empty string here is only a last resort.
function readStored(key: SettingsKey, value: string): string {
  if (!isSealed(value)) return value;
  const encryptionKey = encryptionKeyFromEnv();
  if (!encryptionKey) return "";
  try {
    return open(value, key, encryptionKey);
  } catch {
    return "";
  }
}

export function setSetting(key: SettingsKey, value: string): void {
  const encryptionKey =
    SECRET_SETTINGS_KEYS.has(key) && value !== "" ? encryptionKeyFromEnv() : null;
  setStmt.run(key, encryptionKey ? seal(value, key, encryptionKey) : value);
}

export interface StoredSecretsReport {
  keySet: boolean;
  // Plain-text credentials encrypted just now.
  encrypted: number;
  // Unreadable ones deleted because SETTINGS_ENCRYPTION_RESET=1.
  forgotten: SettingsKey[];
}

// Runs once at start-up, before anything reads a setting. Throws (with what to
// do) if SETTINGS_ENCRYPTION_KEY is malformed, or if saved credentials are
// encrypted but can't be opened: the key is missing or isn't the one they were
// saved with. SETTINGS_ENCRYPTION_RESET=1 deletes those instead, for a lost key.
// With a key, any credential still in plain text is encrypted.
export function prepareStoredSecrets(
  forgetUnreadable = process.env.SETTINGS_ENCRYPTION_RESET?.trim() === "1",
): StoredSecretsReport {
  const encryptionKey = encryptionKeyFromEnv();
  const rows = [...SECRET_SETTINGS_KEYS].flatMap((key) => {
    const row = getStmt.get(key) as { value: string | null } | undefined;
    return row?.value ? [{ key, value: row.value }] : [];
  });

  const unreadable = rows
    .filter(({ key, value }) => {
      if (!isSealed(value)) return false;
      if (!encryptionKey) return true;
      try {
        open(value, key, encryptionKey);
        return false;
      } catch {
        return true;
      }
    })
    .map(({ key }) => key);

  if (unreadable.length > 0 && !forgetUnreadable) {
    const one = unreadable.length === 1;
    const what = `${unreadable.length} saved credential${unreadable.length === 1 ? " is" : "s are"} encrypted (${unreadable.join(", ")})`;
    throw new Error(
      `${what}, but ${encryptionKey ? `this SETTINGS_ENCRYPTION_KEY is not the key ${one ? "it was" : "they were"} saved with` : "SETTINGS_ENCRYPTION_KEY is not set"}. ` +
        "Start Plex Director with that key; every process sharing this database needs the same one. " +
        `If the key is lost, start once with SETTINGS_ENCRYPTION_RESET=1 to delete ${one ? "it" : "them"}, then enter ${one ? "it" : "them"} again on the Settings page and remove SETTINGS_ENCRYPTION_RESET.`,
    );
  }

  const forget = db.prepare("DELETE FROM settings WHERE key = ? AND value = ?");
  // Only if it is still the plain text read above, so two processes starting
  // together can't encrypt one value twice.
  const encrypt = db.prepare("UPDATE settings SET value = ? WHERE key = ? AND value = ?");
  let encrypted = 0;
  db.transaction(() => {
    for (const { key, value } of rows) {
      if (unreadable.includes(key)) forget.run(key, value);
      else if (encryptionKey && !isSealed(value))
        encrypted += encrypt.run(seal(value, key, encryptionKey), key, value).changes;
    }
  })();
  return { keySet: encryptionKey !== null, encrypted, forgotten: unreadable };
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
  PLEX: "PLEX_URL",
} as const;

export function isConfigured(service: keyof typeof SERVICE_URL_KEYS): boolean {
  return getSetting(SERVICE_URL_KEYS[service]) !== "";
}
