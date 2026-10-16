// The parts of Sonarr's v3 API responses this app reads. They describe what
// Sonarr sends and are not checked at runtime, so code that copes with a
// missing field keeps doing so. A field is required only where Sonarr always
// sends it and the code relies on it.

export interface SonarrImage {
  coverType?: string;
  remoteUrl?: string;
}

export interface SonarrSeries {
  id: number;
  title?: string;
  year?: number;
  monitored?: boolean;
  // "continuing", "ended", "upcoming" or "deleted".
  status?: string;
  network?: string;
  seriesType?: string;
  certification?: string;
  runtime?: number;
  path?: string;
  qualityProfileId?: number;
  monitorNewItems?: string;
  firstAired?: string;
  lastAired?: string;
  nextAiring?: string;
  genres?: string[];
  ratings?: { value?: number };
  images?: SonarrImage[];
  alternateTitles?: { title?: string }[];
  statistics?: {
    episodeFileCount: number;
    totalEpisodeCount: number;
    sizeOnDisk?: number;
  };
}

export interface SonarrEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  // The day in the network's own time zone.
  airDate?: string;
  airDateUtc?: string | null;
  hasFile?: boolean;
  monitored?: boolean;
  episodeFileId?: number;
  lastSearchTime?: string;
  // "series", "season" or "midseason".
  finaleType?: string;
}

// /calendar with includeSeries=true.
export interface SonarrCalendarEpisode extends SonarrEpisode {
  series?: SonarrSeries;
}

export interface SonarrEpisodeFile {
  id: number;
  dateAdded: string;
  releaseGroup?: string;
  quality?: { quality?: { name?: string; resolution?: number } };
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
}

export interface SonarrQueueItem {
  seriesId: number;
  episodeId: number;
  status?: string;
  trackedDownloadState?: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string;
  errorMessage?: string;
  statusMessages?: { title?: string; messages?: string[] }[];
}

export interface SonarrHistoryRecord {
  episodeId: number;
  eventType: string;
  date: string;
  sourceTitle?: string;
  // SECURITY: `data` also holds the release's download URL, which contains the
  // indexer's API key. Only the named fields are ever read; the rest are
  // `unknown` so nothing passes them on without a deliberate cast.
  data?: { reason?: string; message?: string; indexer?: string; [other: string]: unknown };
}
