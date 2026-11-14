// The parts of Tautulli's API v2 responses this app reads. Tautulli sends many
// numbers as strings.

export interface TautulliResponse<T> {
  // result is "success" when the command worked; anything else is a failure,
  // explained in message.
  response?: { result?: string; message?: string | null; data?: T };
}

export interface TautulliSession {
  user?: string;
  user_thumb?: string;
  title?: string;
  year?: string | number;
  video_resolution?: string;
  video_decision?: string;
  stream_container?: string;
  transcode_decision?: string;
  progress?: string | number;
  thumb?: string;
  grandparent_thumb?: string;
}

export interface TautulliActivity {
  stream_count?: string | number;
  stream_count_transcode?: string | number;
  stream_count_direct_play?: string | number;
  sessions?: TautulliSession[];
}

// One row of a get_home_stats category. Which fields are set depends on the
// category (titles, users, platforms, libraries), see rowLabel in src/util.ts.
export interface TautulliStatRow {
  title?: string;
  grandparent_title?: string;
  friendly_name?: string;
  user?: string;
  username?: string;
  user_thumb?: string;
  platform?: string;
  platform_name?: string;
  section_name?: string;
  library_name?: string;
  thumb?: string;
  grandparent_thumb?: string;
  total_plays?: number;
  play_count?: number;
  count?: number;
}

export interface TautulliHomeStat {
  stat_id?: string;
  stat_title?: string;
  rows?: TautulliStatRow[];
}

// One row of get_library_media_info for a show library: one show.
export interface TautulliMediaInfoRow {
  // Plex's ratingKey for the show.
  rating_key?: string | number;
  title?: string;
  // Plays in Tautulli's history; null or missing when it has none.
  play_count?: string | number | null;
  // Epoch seconds of the last play; null or missing when there is none.
  last_played?: string | number | null;
}

// get_library_media_info. recordsTotal is how many items Tautulli says the
// library has; data holds at most `length` of them.
export interface TautulliLibraryMediaInfo {
  recordsTotal?: string | number;
  recordsFiltered?: string | number;
  data?: TautulliMediaInfoRow[];
}
