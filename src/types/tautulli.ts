// The parts of Tautulli's API v2 responses this app reads. Tautulli sends many
// numbers as strings.

export interface TautulliResponse<T> {
  response?: { data?: T };
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
