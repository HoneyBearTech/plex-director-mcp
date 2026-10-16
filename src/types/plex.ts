// The parts of Plex Media Server's JSON responses (Accept: application/json)
// this app reads. They describe what Plex sends and are not checked at
// runtime; Plex leaves out any attribute that has no value, so nearly every
// field is optional.

export interface PlexTag {
  tag: string;
}

// One movie, show, season or episode in a library listing.
export interface PlexMetadata {
  ratingKey?: string;
  guid?: string;
  // "movie", "show", "season" or "episode".
  type?: string;
  title?: string;
  // The title Plex sorts by, e.g. without a leading "The".
  titleSort?: string;
  summary?: string;
  year?: number;
  thumb?: string;
  // The studio for a movie, the network for a show.
  studio?: string;
  audienceRating?: number;
  rating?: number;
  contentRating?: string;
  // Shows: seasons, episodes, and episodes watched.
  childCount?: number;
  leafCount?: number;
  viewedLeafCount?: number;
  viewCount?: number;
  // Milliseconds.
  viewOffset?: number;
  duration?: number;
  // Epoch seconds.
  lastViewedAt?: number;
  addedAt?: number;
  originallyAvailableAt?: string;
  // Episodes: episode and season numbers, and the show they belong to.
  index?: number;
  parentIndex?: number;
  grandparentTitle?: string;
  grandparentGuid?: string;
  grandparentThumb?: string;
  librarySectionTitle?: string;
  Genre?: PlexTag[];
  Guid?: { id?: string }[];
}

// A library section, a genre, or (in a search hub) a person.
export interface PlexDirectory {
  key?: string;
  title?: string;
  type?: string;
  id?: number | string;
  tag?: string;
}

export interface PlexHub {
  type?: string;
  Directory?: PlexDirectory[];
}

export interface PlexContainer {
  MediaContainer?: {
    totalSize?: number;
    Metadata?: PlexMetadata[];
    Directory?: PlexDirectory[];
    Hub?: PlexHub[];
  };
}
