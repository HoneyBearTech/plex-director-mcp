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
  radarr: { url: string; apiKey: SecretField };
  prowlarr: { url: string; apiKey: SecretField };
  sabnzbd: { url: string; apiKey: SecretField };
  qbittorrent: { url: string; username: string; password: SecretField };
  tautulli: { url: string; apiKey: SecretField };
  tmdb: { apiKey: SecretField };
  nodes: { hosts: string; sshUser: string };
}

export type SettingsService = keyof SettingsResponse;

export interface ChatImage {
  mimeType: string;
  data: string;
}

export interface ChatAnswer {
  text: string;
  images: ChatImage[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
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
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed: ${response.status}`);
  }
  return data as T;
}

export const api = {
  chatWithMovies: (question: string) => postJson<ChatAnswer>("/api/chat/movies", { question }),
  plexActivity: () => getJson<PlexActivity>("/api/status/activity"),
  libraryAnalytics: () => getJson<LibraryAnalytics>("/api/status/library-analytics"),
  nodeHealth: () => getJson<{ hosts: NodeHealth[] }>("/api/nodes/health"),
  sabnzbdQueue: () => getJson<{ items: SabnzbdItem[] }>("/api/queues/sabnzbd"),
  qbittorrentQueue: () => getJson<{ items: QbittorrentItem[] }>("/api/queues/qbittorrent"),
  getSettings: () => getJson<SettingsResponse>("/api/settings"),
  updateSettings: (service: SettingsService, body: Record<string, string>) =>
    putJson(`/api/settings/${service}`, body),
};
