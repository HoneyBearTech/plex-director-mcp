import axios from "axios";
import { getSetting } from "./settings.js";

// Axios has no default timeout - an unreachable host would otherwise hang a
// request indefinitely, which is tolerable for a one-off chat tool call but
// turns into a permanently-spinning tab for the web UI.
const REQUEST_TIMEOUT_MS = 10_000;

// Every client is created once, always non-null, with whatever settings are
// currently available (baseURL may be empty if a service isn't configured
// yet - the server must be able to boot with zero configuration and let the
// Settings page fill things in afterward). refreshClients() mutates these
// same instances' .defaults in place whenever settings change, so every
// existing import of e.g. radarrClient across src/tools/ and
// src/web/routes/ picks up new values automatically with no restart and no
// changes needed at those call sites.

export const sabnzbdClient = axios.create({ timeout: REQUEST_TIMEOUT_MS });
export const radarrClient = axios.create({ timeout: REQUEST_TIMEOUT_MS });
export const sonarrClient = axios.create({ timeout: REQUEST_TIMEOUT_MS });
export const tautulliClient = axios.create({ timeout: REQUEST_TIMEOUT_MS });
export const tmdbClient = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  headers: { Accept: "application/json" },
  timeout: REQUEST_TIMEOUT_MS,
});
export const prowlarrClient = axios.create({ timeout: REQUEST_TIMEOUT_MS });
export const qbitClient = axios.create({ withCredentials: true, timeout: REQUEST_TIMEOUT_MS });

function tautulliApiUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  return /\/api\/v2\/?$/i.test(rawUrl) ? rawUrl.replace(/\/+$/, "") : `${rawUrl.replace(/\/+$/, "")}/api/v2`;
}

export function refreshClients(): void {
  sabnzbdClient.defaults.baseURL = getSetting("SABNZBD_URL");
  sabnzbdClient.defaults.params = { apikey: getSetting("SABNZBD_API_KEY"), output: "json" };

  radarrClient.defaults.baseURL = getSetting("RADARR_URL");
  radarrClient.defaults.headers.common["X-Api-Key"] = getSetting("RADARR_API_KEY");

  sonarrClient.defaults.baseURL = getSetting("SONARR_URL");
  sonarrClient.defaults.headers.common["X-Api-Key"] = getSetting("SONARR_API_KEY");

  tautulliClient.defaults.baseURL = tautulliApiUrl(getSetting("TAUTULLI_URL"));
  tautulliClient.defaults.params = { apikey: getSetting("TAUTULLI_API_KEY"), cmd: "" };

  tmdbClient.defaults.headers.common["Authorization"] = `Bearer ${getSetting("TMDB_API_KEY")}`;

  prowlarrClient.defaults.baseURL = getSetting("PROWLARR_URL");
  prowlarrClient.defaults.headers.common["X-Api-Key"] = getSetting("PROWLARR_API_KEY");

  qbitClient.defaults.baseURL = getSetting("QBITTORRENT_URL");
}
