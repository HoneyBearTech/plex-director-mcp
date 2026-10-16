// The parts of TMDb's v3 API responses this app reads. They describe what TMDb
// sends and are not checked at runtime.

export interface TmdbPage<T> {
  results?: T[];
}

export interface TmdbPerson {
  id: number;
  name?: string;
}

export interface TmdbMovie {
  id: number;
  title?: string;
  // YYYY-MM-DD, or "" when unknown.
  release_date?: string;
  poster_path?: string | null;
  overview?: string;
}

// One role from /person/{id}/movie_credits or /tv_credits: movies have a title
// and release date, shows a name and first air date.
export interface TmdbCastCredit {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  character?: string;
  poster_path?: string | null;
  vote_average?: number;
  genre_ids?: number[];
}
