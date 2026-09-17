export interface MovieStatus {
  found: boolean;
  inRadarrDatabase?: boolean;
  title?: string;
  year?: number;
  monitored?: boolean;
  status?: string;
  hasFile?: boolean;
  path?: string | null;
  overview?: string | null;
  posterUrl?: string | null;
}

export interface DiagnoseStep {
  step: string;
  status: "ok" | "warn" | "error" | "info";
  detail: string;
}

export interface SearchResult {
  tmdbId: number;
  title: string;
  year: string | null;
  overview: string | null;
  posterUrl: string | null;
}

export interface PlexSession {
  user: string;
  title: string;
  year: number | null;
  resolution: string;
  container: string;
  transcoding: boolean;
  progress: number;
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
    rows: Array<{ label: string; plays: number }>;
  }>;
}

export interface NodeHealth {
  host: string;
  online: boolean;
  cpuPercent?: number;
  ramPercent?: number;
  ramUsedMb?: number;
  ramTotalMb?: number;
  containersRunning?: number;
  deadContainers?: string[];
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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed: ${response.status}`);
  }
  return data as T;
}

export const api = {
  movieStatus: (title: string) => getJson<MovieStatus>(`/api/movies/status?title=${encodeURIComponent(title)}`),
  movieDiagnose: (title: string) => getJson<{ steps: DiagnoseStep[] }>(`/api/movies/diagnose?title=${encodeURIComponent(title)}`),
  movieSearch: (query: string) => getJson<{ results: SearchResult[] }>(`/api/movies/search?query=${encodeURIComponent(query)}`),
  plexActivity: () => getJson<PlexActivity>("/api/status/activity"),
  libraryAnalytics: () => getJson<LibraryAnalytics>("/api/status/library-analytics"),
  nodeHealth: () => getJson<{ hosts: NodeHealth[] }>("/api/nodes/health"),
  sabnzbdQueue: () => getJson<{ items: SabnzbdItem[] }>("/api/queues/sabnzbd"),
  qbittorrentQueue: () => getJson<{ items: QbittorrentItem[] }>("/api/queues/qbittorrent"),
};
