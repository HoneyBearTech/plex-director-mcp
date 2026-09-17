import axios from "axios";
import { requiredEnv } from "./env.js";

const radarrUrl = requiredEnv("RADARR_URL");
const radarrApiKey = requiredEnv("RADARR_API_KEY");
const sabnzbdUrl = requiredEnv("SABNZBD_URL");
const sabnzbdApiKey = requiredEnv("SABNZBD_API_KEY");
const tautulliUrl = requiredEnv("TAUTULLI_URL");
const tautulliApiKey = requiredEnv("TAUTULLI_API_KEY");
const tmdbApiKey = requiredEnv("TMDB_API_KEY");
const prowlarrUrl = requiredEnv("PROWLARR_URL");
const prowlarrApiKey = requiredEnv("PROWLARR_API_KEY");

// Axios has no default timeout - an unreachable host would otherwise hang a
// request indefinitely, which is tolerable for a one-off chat tool call but
// turns into a permanently-spinning tab for the web UI.
const REQUEST_TIMEOUT_MS = 10_000;

export const sabnzbdClient = axios.create({
  baseURL: sabnzbdUrl,
  params: { apikey: sabnzbdApiKey, output: "json" },
  timeout: REQUEST_TIMEOUT_MS,
});

export const radarrClient = axios.create({
  baseURL: radarrUrl,
  headers: { "X-Api-Key": radarrApiKey },
  timeout: REQUEST_TIMEOUT_MS,
});

const sonarrUrl = process.env.SONARR_URL?.trim();
const sonarrApiKey = process.env.SONARR_API_KEY?.trim();
export const sonarrClient = sonarrUrl && sonarrApiKey
  ? axios.create({
      baseURL: sonarrUrl,
      headers: { "X-Api-Key": sonarrApiKey },
      timeout: REQUEST_TIMEOUT_MS,
    })
  : null;

const tautulliApiUrl = /\/api\/v2\/?$/i.test(tautulliUrl)
  ? tautulliUrl.replace(/\/+$/, "")
  : `${tautulliUrl.replace(/\/+$/, "")}/api/v2`;

export const tautulliClient = axios.create({
  baseURL: tautulliApiUrl,
  params: { apikey: tautulliApiKey, cmd: "" },
  timeout: REQUEST_TIMEOUT_MS,
});

export const tmdbClient = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  headers: {
    Authorization: `Bearer ${tmdbApiKey}`,
    Accept: "application/json",
  },
  timeout: REQUEST_TIMEOUT_MS,
});

export const prowlarrClient = axios.create({
  baseURL: prowlarrUrl,
  headers: { "X-Api-Key": prowlarrApiKey },
  timeout: REQUEST_TIMEOUT_MS,
});

// qBittorrent is optional because the core Radarr, TMDb, and monitoring tools
// can run without a configured torrent client.
export const qbitClient = axios.create({
  baseURL: process.env.QBITTORRENT_URL ?? "",
  withCredentials: true,
  timeout: REQUEST_TIMEOUT_MS,
});
