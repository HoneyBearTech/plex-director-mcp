import type { PlexMetadata } from "../types/plex.js";
import type { SonarrSeries } from "../types/sonarr.js";

// Which Sonarr series is this Plex show? Plex and Sonarr share no id of their
// own, but both record the show's TVDB id: Plex in its Guid list (asked for
// with includeGuids=1), Sonarr as tvdbId. A show Plex holds no TVDB id for is
// matched by title and year instead. Nothing is guessed beyond that: a show
// that matches neither way is reported as not matched.

// Lowercase, no accents, "&" as "and", punctuation as spaces.
export function foldShowTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const titleYearKey = (title: unknown, year: unknown): string | null => {
  const folded = typeof title === "string" ? foldShowTitle(title) : "";
  return folded && typeof year === "number" && year > 0 ? `${folded}|${year}` : null;
};

// The TVDB ids Plex holds for a show, over every library copy of it (an HD and
// a 4K copy are the same show, and only one of them may be matched to TVDB).
export function tvdbIdsOf(copies: PlexMetadata[]): number[] {
  const ids = new Set<number>();
  for (const copy of copies) {
    for (const guid of copy.Guid ?? []) {
      const match = typeof guid.id === "string" ? /^tvdb:\/\/(\d+)$/.exec(guid.id) : null;
      if (match) ids.add(Number(match[1]));
    }
  }
  return [...ids];
}

export interface SonarrShowIndex {
  byTvdbId: Map<number, SonarrSeries>;
  // Folded title plus year -> the series, or null when several series share it.
  byTitleYear: Map<string, SonarrSeries | null>;
}

export function indexSonarrSeries(all: SonarrSeries[]): SonarrShowIndex {
  const byTvdbId = new Map<number, SonarrSeries>();
  const byTitleYear = new Map<string, SonarrSeries | null>();
  for (const series of all) {
    if (typeof series.tvdbId === "number" && series.tvdbId > 0 && !byTvdbId.has(series.tvdbId))
      byTvdbId.set(series.tvdbId, series);
    const key = titleYearKey(series.title, series.year);
    if (key) byTitleYear.set(key, byTitleYear.has(key) ? null : series);
  }
  return { byTvdbId, byTitleYear };
}

// The Sonarr series for one Plex show, given every library copy of it; null
// when Sonarr doesn't have it. A show with a TVDB id is matched by that id
// alone: its title is not tried, because a different show can share a title.
export function matchShowToSonarr(
  copies: PlexMetadata[],
  index: SonarrShowIndex,
): SonarrSeries | null {
  const tvdbIds = tvdbIdsOf(copies);
  if (tvdbIds.length > 0) {
    for (const id of tvdbIds) {
      const series = index.byTvdbId.get(id);
      if (series) return series;
    }
    return null;
  }
  for (const copy of copies) {
    const key = titleYearKey(copy.title, copy.year);
    const series = key ? index.byTitleYear.get(key) : undefined;
    if (series) return series;
  }
  return null;
}
