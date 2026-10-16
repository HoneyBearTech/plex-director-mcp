// The parts of Radarr's v3 API responses this app reads. They describe what
// Radarr sends and are not checked at runtime.

export interface RadarrMovie {
  // Absent on /movie/lookup results for movies that are not in Radarr.
  id?: number;
  title?: string;
  year?: number;
  tmdbId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  status?: string;
  path?: string;
  overview?: string;
  images?: { coverType?: string; remoteUrl?: string }[];
  movieFile?: { quality?: { quality?: { name?: string } } };
}

// A movie Radarr manages (/movie), which always has an id.
export interface RadarrLibraryMovie extends RadarrMovie {
  id: number;
}

export interface RadarrHistoryRecord {
  eventType: string;
  data?: { droppedPath?: string; [other: string]: unknown };
}

export interface RadarrQualityProfile {
  id: number;
  name: string;
}

export interface RadarrRootFolder {
  path: string;
}

// The body of a 400 from Radarr: one entry per failed validation.
export interface RadarrValidationError {
  errorMessage?: string;
  message?: string;
}
