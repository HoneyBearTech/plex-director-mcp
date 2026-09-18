import { Router } from "express";
import { getSetting, setSetting, type SettingsKey } from "../../settings.js";
import { refreshClients } from "../../clients.js";

interface FieldDef {
  field: string;
  key: SettingsKey;
  secret?: boolean;
}

// Service -> editable fields, and the .env/DB key each one maps to. The
// Settings page's 9 tabs (Sonarr, Radarr, Prowlarr, SABnzbd, qBittorrent,
// Tautulli, Plex, TMDB, Nodes) correspond directly to these keys.
const SERVICES: Record<string, FieldDef[]> = {
  sonarr: [
    { field: "url", key: "SONARR_URL" },
    { field: "apiKey", key: "SONARR_API_KEY", secret: true },
  ],
  radarr: [
    { field: "url", key: "RADARR_URL" },
    { field: "apiKey", key: "RADARR_API_KEY", secret: true },
  ],
  prowlarr: [
    { field: "url", key: "PROWLARR_URL" },
    { field: "apiKey", key: "PROWLARR_API_KEY", secret: true },
  ],
  sabnzbd: [
    { field: "url", key: "SABNZBD_URL" },
    { field: "apiKey", key: "SABNZBD_API_KEY", secret: true },
  ],
  qbittorrent: [
    { field: "url", key: "QBITTORRENT_URL" },
    { field: "username", key: "QBITTORRENT_USER" },
    { field: "password", key: "QBITTORRENT_PASS", secret: true },
  ],
  tautulli: [
    { field: "url", key: "TAUTULLI_URL" },
    { field: "apiKey", key: "TAUTULLI_API_KEY", secret: true },
  ],
  plex: [
    { field: "url", key: "PLEX_URL" },
    { field: "token", key: "PLEX_TOKEN", secret: true },
  ],
  tmdb: [{ field: "apiKey", key: "TMDB_API_KEY", secret: true }],
  // SSH_KEY_PATH deliberately excluded - stays a server-side file path, never
  // typed into the browser or stored in the database.
  nodes: [
    { field: "hosts", key: "UBUNTU_HOSTS" },
    { field: "sshUser", key: "SSH_USER" },
  ],
};

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  const result: Record<string, Record<string, string | { configured: boolean }>> = {};

  for (const [service, fields] of Object.entries(SERVICES)) {
    const serviceResult: Record<string, string | { configured: boolean }> = {};
    for (const f of fields) {
      const value = getSetting(f.key);
      // Secret-shaped fields never round-trip to the browser in full - an
      // unauthenticated GET shouldn't hand out live credentials.
      serviceResult[f.field] = f.secret ? { configured: value !== "" } : value;
    }
    result[service] = serviceResult;
  }

  res.json(result);
});

settingsRouter.put("/:service", (req, res) => {
  const fields = SERVICES[req.params.service];
  if (!fields) {
    res.status(404).json({ error: `Unknown service: ${req.params.service}` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const f of fields) {
    const raw = body[f.field];
    if (typeof raw !== "string") continue; // field omitted - leave unchanged
    if (f.secret && raw.trim() === "") continue; // blank secret - keep the existing value
    setSetting(f.key, raw.trim());
  }

  refreshClients();
  res.json({ ok: true });
});
