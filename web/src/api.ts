export interface PlexSession {
  user: string;
  userThumb: string | null;
  title: string;
  year: number | null;
  resolution: string;
  container: string;
  transcoding: boolean;
  progress: number;
  posterUrl: string | null;
}

export interface PlexActivity {
  streamCount: number;
  transcodeCount: number;
  directPlayCount: number;
  sessions: PlexSession[];
}

export interface LibraryAnalytics {
  categories: Array<{
    title: string;
    rows: Array<{ label: string; plays: number; posterUrl: string | null; userThumb: string | null }>;
  }>;
}

export interface NodeHealth {
  host: string;
  hostname: string;
  online: boolean;
  cpuPercent?: number;
  ramPercent?: number;
  ramUsedMb?: number;
  ramTotalMb?: number;
  containersRunning?: number;
  deadContainers?: string[];
  diskPercent?: number;
  diskUsed?: string;
  diskTotal?: string;
  uptime?: string;
  // Offline hosts only: why, and whether the SSH host key changed.
  error?: string;
  hostKeyChanged?: { expected: string; actual: string };
}

export interface SabnzbdItem {
  filename: string;
  status: string;
  percentage: number;
  timeleft: string;
  sizeMb: number;
  sizeLeftMb: number;
}

export interface QbittorrentItem {
  name: string;
  state: string;
  progress: number;
  dlspeedKbps: number;
  sizeBytes: number;
  seeders: number;
  stalled: boolean;
}

export type SecretField = { configured: boolean };

export interface SettingsResponse {
  sonarr: { url: string; apiKey: SecretField };
  radarr: { url: string; apiKey: SecretField; defaultQualityProfile: string };
  prowlarr: { url: string; apiKey: SecretField };
  sabnzbd: { url: string; apiKey: SecretField };
  qbittorrent: { url: string; username: string; password: SecretField };
  tautulli: { url: string; apiKey: SecretField };
  plex: { url: string; token: SecretField; skipLibraries: string };
  tmdb: { apiKey: SecretField };
  nodes: { hosts: string; sshUser: string };
}

export type SettingsService = keyof SettingsResponse;

export interface ChatImage {
  mimeType: string;
  data: string;
}

// Mirrors MediaRow in src/tools/plex.ts.
export interface MediaRow {
  kind: "movie" | "show";
  title: string;
  year: number | null;
  posterUrl: string | null;
  // Libraries holding it in Plex; [] = not in Plex; null = not checked.
  libraries: string[] | null;
  genres: string[];
  rating: number | null;
  detail: string | null;
  // Only on shows.
  show?: {
    seasons: number | null;
    episodes: number | null;
    watchedEpisodes: number | null;
    ownedEpisodes?: number | null;
    network: string | null;
  };
}

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  text: string;
  media?: MediaRow[];
}

export interface ChatAnswer {
  text: string;
  images: ChatImage[];
  media: MediaRow[];
}

// Mirrors the /api/jobs response in src/web/routes/jobs.ts.
export interface BackgroundJob {
  id: number;
  taskName: string;
  status: string;
  totalItems: number;
  processedItems: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export type IndexerState = "healthy" | "warning" | "backing-off" | "disabled";

// Mirrors IndexerRow / IndexerHealth in src/indexers.ts.
export interface IndexerRow {
  id: number;
  name: string;
  protocol: string;
  priority: number;
  enabled: boolean;
  state: IndexerState;
  mostRecentFailure: string | null;
  disabledTill: string | null;
  escalationLevel: number;
}

export interface IndexerHealth {
  indexers: IndexerRow[];
  warnings: { type: string; source: string; message: string }[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  notifyIfUnauthorized(url, response);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed: ${response.status}`);
  }
  return data as T;
}

async function putJson(url: string, body: Record<string, string>): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed: ${response.status}`);
  }
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  notifyIfUnauthorized(url, response);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed: ${response.status}`);
  }
  return data as T;
}

// Fired when an API call comes back 401 (e.g. the session expired), so the app
// can show the login page instead of a page full of errors.
export const AUTH_REQUIRED_EVENT = "plex-director:auth-required";

function notifyIfUnauthorized(url: string, response: Response) {
  if (response.status === 401 && !url.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
}

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
}

export const api = {
  // history = the earlier messages of this conversation, so follow-ups have context.
  chatWithMovies: (question: string, history: ChatHistoryTurn[] = []) =>
    postJson<ChatAnswer>("/api/chat/movies", { question, history }),
  plexActivity: () => getJson<PlexActivity>("/api/status/activity"),
  libraryAnalytics: () => getJson<LibraryAnalytics>("/api/status/library-analytics"),
  authStatus: () => getJson<AuthStatus>("/api/auth/status"),
  login: (password: string) => postJson<{ ok: boolean }>("/api/auth/login", { password }),
  logout: () => postJson<{ ok: boolean }>("/api/auth/logout", {}),
  nodeHealth: () => getJson<{ hosts: NodeHealth[] }>("/api/nodes/health"),
  trustNewKey: (host: string) => postJson<{ ok: boolean }>("/api/nodes/trust-new-key", { host }),
  sabnzbdQueue: () => getJson<{ items: SabnzbdItem[] }>("/api/queues/sabnzbd"),
  qbittorrentQueue: () => getJson<{ items: QbittorrentItem[] }>("/api/queues/qbittorrent"),
  indexerHealth: () => getJson<IndexerHealth>("/api/indexers/health"),
  backgroundJobs: () => getJson<{ jobs: BackgroundJob[] }>("/api/jobs"),
  getSettings: () => getJson<SettingsResponse>("/api/settings"),
  updateSettings: (service: SettingsService, body: Record<string, string>) =>
    putJson(`/api/settings/${service}`, body),
};
