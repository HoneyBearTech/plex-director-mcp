import type { PlexMetadata } from "../types/plex.js";
import type { SonarrSeries } from "../types/sonarr.js";

// Which Sonarr series is this Plex show? Plex and Sonarr share no id of their
// own, but both record the show's TVDB id: Plex in its Guid list (asked for
// with includeGuids=1), Sonarr as tvdbId. A show Plex holds no TVDB id for is
// matched by title and year instead. Nothing is guessed beyond that: a show
// that matches neither way is reported as not matched.

// What is folded: symbols become spaces before anything else, so "™" and "№"
// do not turn into letters; case; "&" as "and"; punctuation as spaces; width
// and compatibility forms (full-width ＡＢＣ and ２, half-width katakana, the ﬁ
// ligature); superscripts and fractions fold to their digits ("²" is "2", "½"
// is "1 2"); optional marks on Latin, Greek, Hebrew and Arabic letters
// (Pokémon = Pokemon, Greek tonos, Hebrew points, Arabic vowel marks, hamza and
// madda, so أ and ا fold together); and a mark that follows no letter. What is
// not: marks in other scripts are kept, composed where possible, because they
// separate letters (Japanese か and が, Cyrillic й and и, Devanagari and Thai
// signs). Known limits: Cyrillic ё and е stay different, "ß" is not "ss".
export function foldShowTitle(title: string): string {
  return title
    .replace(/\p{S}+/gu, " ")
    .normalize("NFKD")
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Hebrew}\p{Script=Arabic}])\p{M}+/gu, "$1")
    .replace(/(^|[^\p{L}\p{M}])\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
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
// when Sonarr doesn't have it, when its title and year match more than one
// series, or when the Sonarr series has no TVDB id while the Plex show has one. A show with a TVDB id is matched by that id
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
