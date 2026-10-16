// The parts of Prowlarr's v1 API responses this app reads.

export interface ProwlarrIndexer {
  id: number;
  name?: string;
  protocol?: string;
  priority?: number;
  enable?: boolean;
}

// /indexerstatus only has entries for indexers that failed recently.
export interface ProwlarrIndexerStatus {
  indexerId: number;
  disabledTill?: string;
  mostRecentFailure?: string;
  escalationLevel?: number;
}

export interface ProwlarrHealthCheck {
  type?: string;
  source?: string;
  message?: string;
}
