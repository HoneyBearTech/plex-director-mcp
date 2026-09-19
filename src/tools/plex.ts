import { plexClient } from "../clients.js";
import { getSetting, isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";

export type MediaKind = "movie" | "show";

// One movie or show in a result list. Tools attach these as structuredContent
// so the web UI can render a table with posters; the text reply stays for MCP
// clients and for the model. posterUrl is always something the browser can load
// directly (a same-origin proxy URL or a public image URL), never a raw Plex
// URL, which would need the token.
export interface MediaRow {
  kind: MediaKind;
  title: string;
  year: number | null;
  posterUrl: string | null;
  // Libraries holding it in Plex. Empty array = known not to be in Plex;
  // null = ownership wasn't checked.
  libraries: string[] | null;
  genres: string[];
  rating: number | null;
  // Extra per-row context, e.g. the role an actor played.
  detail: string | null;
  // Only on shows: what Plex holds of it. Null where Plex didn't say.
  show?: {
    seasons: number | null;
    episodes: number | null;
    watchedEpisodes: number | null;
    // Set by the Sonarr tools instead of watchedEpisodes: how many of
    // `episodes` (the aired ones) are downloaded.
    ownedEpisodes?: number | null;
    network: string | null;
  };
  // Set only when the query was about watching or adding: YYYY-MM-DD dates.
  // lastWatched null = never watched; "date unknown" = watched, but Plex
  // recorded no date for it.
  lastWatched?: string | null;
  added?: string | null;
}

export type WatchFilter = "unwatched" | "inProgress" | "watched";
export type SearchSort = "title" | "recentlyAdded" | "lastWatched" | "leastRecentlyWatched";

export interface PlexSearchArgs {
  title?: string;
  genre?: string;
  actor?: string;
  year?: number;
  // Search movie libraries, show libraries, or both (the default).
  mediaType?: "movie" | "show" | "any";
  // Only libraries whose name contains this text (case-insensitive), e.g. "4k".
  library?: string;
  // Watch state of the Plex account the app is connected with. Movies:
  // unwatched = never played, inProgress = partly played, watched = played
  // through at least once. Shows: no episodes / some but not all / all watched.
  watched?: WatchFilter;
  // Only titles with no watching in this many years. A never-watched title
  // counts from when it was added.
  notWatchedInYears?: number;
  sort?: SearchSort;
  limit?: number;
  // How many matches to skip, for paging through a large result.
  offset?: number;
}

const DEFAULT_LIMIT = 25;
const DAY_MS = 86_400_000;
const MAX_LIMIT = 500;
// Plex is asked for everything that matches in one go; libraries here are
// well under this, so it is effectively "all".
const FETCH_ALL = 5000;

interface PlexSection {
  key: string;
  title: string;
  kind: MediaKind;
}

// A server can have several libraries of a kind (e.g. HD, 4K, kids,
// documentaries); an "I own" question has to look across all of them.
async function getSections(kinds: MediaKind[]): Promise<PlexSection[]> {
  const response = await plexClient.get("/library/sections");
  const directories: any[] = response.data?.MediaContainer?.Directory ?? [];
  return directories
    .filter((d) => kinds.includes(d.type))
    .map((d) => ({ key: String(d.key), title: String(d.title), kind: d.type as MediaKind }));
}

// Libraries the Settings page says to leave out unless one is asked for by name
// (e.g. "Sports"). Whole names, case-insensitive, comma-separated.
function skippedLibraryNames(): Set<string> {
  return new Set(
    getSetting("PLEX_SKIP_LIBRARIES")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Plex filters take tag ids, not names, and genre ids are the same in every
// library, so any library that has the genre can supply the key.
async function resolveGenre(
  name: string,
  sections: PlexSection[]
): Promise<{ key: string } | { available: string[] }> {
  const lists = await Promise.all(
    sections.map(async (section) => {
      const response = await plexClient.get(`/library/sections/${section.key}/genre`);
      return (response.data?.MediaContainer?.Directory ?? []) as Array<{ key: string; title: string }>;
    })
  );

  const byName = new Map<string, { key: string; title: string }>();
  for (const genre of lists.flat()) {
    const lower = genre.title.toLowerCase();
    if (!byName.has(lower)) byName.set(lower, genre);
  }

  const match = byName.get(name.trim().toLowerCase());
  if (match) return { key: String(match.key) };
  return { available: [...byName.values()].map((g) => g.title).sort() };
}

// The library's own actor list can't be filtered by name, but the hub search
// returns matching people with the same tag ids the actor filter accepts.
async function resolveActor(
  name: string
): Promise<{ id: string; name: string } | { candidates: string[] } | null> {
  const response = await plexClient.get("/hubs/search", { params: { query: name, limit: 10 } });
  const hubs: any[] = response.data?.MediaContainer?.Hub ?? [];
  const actorHub = hubs.find((h) => h.type === "actor");
  const entries: Array<{ id: number | string; tag: string }> = actorHub?.Directory ?? [];

  // The same person shows up once per library that contains them.
  const unique = new Map<string, string>();
  for (const entry of entries) unique.set(String(entry.id), entry.tag);
  if (unique.size === 0) return null;

  const wanted = name.trim().toLowerCase();
  const people = [...unique].map(([id, tag]) => ({ id, name: tag }));
  const exact = people.filter((p) => p.name.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0]!;
  if (people.length === 1) return people[0]!;
  return { candidates: people.map((p) => p.name) };
}

function guidOf(item: any, scheme: string): string | null {
  const guid = (item.Guid ?? []).find((g: any) => typeof g.id === "string" && g.id.startsWith(`${scheme}://`));
  return guid ? guid.id.slice(scheme.length + 3) : null;
}

function tmdbIdOf(item: any): string | null {
  return guidOf(item, "tmdb");
}

// The ids that identify one title, best first. TMDb and TVDB numbers overlap
// each other and movies overlap shows, so each is namespaced. Shows fall back
// to TVDB when Plex has no TMDb match for them.
function identityKeys(item: any, kind: MediaKind): string[] {
  const keys: string[] = [];
  const tmdb = tmdbIdOf(item);
  if (tmdb) keys.push(`${kind}:tmdb:${tmdb}`);
  if (kind === "show") {
    const tvdb = guidOf(item, "tvdb");
    if (tvdb) keys.push(`${kind}:tvdb:${tvdb}`);
  }
  if (keys.length === 0) keys.push(`${kind}:${item.title}|${item.year}`);
  return keys;
}

function plexPosterUrl(thumb: unknown): string | null {
  return typeof thumb === "string" && thumb ? `/api/plex/image?path=${encodeURIComponent(thumb)}` : null;
}

// Movies and shows actually in the Plex library, filtered by any combination of
// genre, actor, title, and year. Complements check_movie_status (Radarr - what's
// managed) and the TMDb tools (what exists) with "what can I actually watch".
export async function searchPlexLibrary(args: PlexSearchArgs, now: number = Date.now()) {
  if (!isConfigured("PLEX")) {
    return textReply("Plex isn't configured. Set the Plex URL and token on the Settings page (or PLEX_URL / PLEX_TOKEN in .env).", true);
  }

  const { title, genre, actor, year, library, watched, notWatchedInYears } = args;
  const mediaType = args.mediaType ?? "any";
  const sort = args.sort ?? "title";
  if (!title && !genre && !actor && year === undefined && !library && mediaType === "any" && !watched && notWatchedInYears === undefined && sort === "title") {
    return textReply("Provide at least one of: title, genre, actor, year, library, mediaType, watched, notWatchedInYears, sort.", true);
  }
  if (notWatchedInYears !== undefined && !(notWatchedInYears > 0)) {
    return textReply("notWatchedInYears must be greater than 0.", true);
  }
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(args.offset ?? 0, 0);
  const kinds: MediaKind[] = mediaType === "any" ? ["movie", "show"] : [mediaType];
  const noun = mediaType === "any" ? "movies or shows" : `${mediaType}s`;

  try {
    const allSections = await getSections(kinds);
    if (allSections.length === 0) {
      return textReply(`No ${mediaType === "any" ? "movie or show" : mediaType} libraries found in Plex.`, true);
    }

    // Genre and actor ids are server-wide, so they're resolved against every
    // library; only the search itself is narrowed by the library filter. A
    // library named in the filter is searched even if the Settings page says
    // to skip it by default.
    let sections = allSections;
    if (library) {
      const wanted = library.trim().toLowerCase();
      sections = allSections.filter((s) => s.title.toLowerCase().includes(wanted));
      if (sections.length === 0) {
        return textReply(`No ${mediaType === "any" ? "movie or show" : mediaType} library matching "${library}" in Plex. Libraries: ${allSections.map((s) => s.title).join(", ")}.`, true);
      }
    } else {
      const skipped = skippedLibraryNames();
      sections = allSections.filter((s) => !skipped.has(s.title.toLowerCase()));
      if (sections.length === 0) {
        return textReply(`Every ${mediaType === "any" ? "movie and show" : mediaType} library is skipped by default (Plex "Libraries to skip" setting). Name one with the library filter: ${allSections.map((s) => s.title).join(", ")}.`, true);
      }
    }

    const filters: Record<string, string | number> = {};
    const described: string[] = [];

    if (title) {
      filters.title = title;
      described.push(`title "${title}"`);
    }
    if (watched) {
      described.push(watched === "inProgress" ? "in progress" : watched);
    }
    if (notWatchedInYears !== undefined) {
      described.push(`not watched in ${notWatchedInYears} year${notWatchedInYears === 1 ? "" : "s"}`);
    }
    if (year !== undefined) {
      filters.year = year;
      described.push(`year ${year}`);
    }
    if (library) {
      described.push(`in ${sections.map((s) => `"${s.title}"`).join(", ")}`);
    }
    if (genre) {
      const resolved = await resolveGenre(genre, allSections);
      if ("available" in resolved) {
        return textReply(`No genre "${genre}" in Plex. Available genres: ${resolved.available.join(", ")}.`, true);
      }
      filters.genre = resolved.key;
      described.push(`genre "${genre}"`);
    }
    if (actor) {
      const resolved = await resolveActor(actor);
      if (!resolved) {
        return textReply(`No actor matching "${actor}" found in the Plex library.`, true);
      }
      if ("candidates" in resolved) {
        return textReply(`"${actor}" matches several people in Plex: ${resolved.candidates.join(", ")}. Ask again with the full name.`, true);
      }
      filters.actor = resolved.id;
      described.push(`actor ${resolved.name}`);
    }

    // Every match is fetched (not one page): a title held in several libraries
    // must be counted once and paged as one, which needs the whole set.
    const perSection = await Promise.all(
      sections.map(async (section) => {
        const response = await plexClient.get(`/library/sections/${section.key}/all`, {
          params: {
            ...filters,
            includeGuids: 1,
            "X-Plex-Container-Start": 0,
            "X-Plex-Container-Size": FETCH_ALL,
          },
        });
        const items: any[] = response.data?.MediaContainer?.Metadata ?? [];
        return { section, items };
      })
    );

    // One entry per title, listing every library that holds it (HD and 4K
    // copies are the same title, not two results). A title is found by any of
    // its ids, so a copy Plex matched only by TVDB still joins the one it
    // matched by TMDb.
    interface Group {
      kind: MediaKind;
      item: any;
      libraries: string[];
      watch: Watch;
    }
    const groups: Group[] = [];
    const byKey = new Map<string, Group>();
    for (const { section, items } of perSection) {
      for (const item of items) {
        const keys = identityKeys(item, section.kind);
        const existing = keys.map((k) => byKey.get(k)).find((g) => g !== undefined);
        if (existing) {
          existing.libraries.push(section.title);
          existing.watch = mergeWatch(existing.watch, watchOf(item, section.kind));
          for (const k of keys) byKey.set(k, existing);
        } else {
          const group: Group = { kind: section.kind, item, libraries: [section.title], watch: watchOf(item, section.kind) };
          groups.push(group);
          for (const k of keys) byKey.set(k, group);
        }
      }
    }

    // Watch filters run on the whole title (all its libraries), before paging.
    let candidates = watched ? groups.filter((g) => matchesWatch(g.kind, g.watch, watched)) : groups;
    let undated = 0;
    if (notWatchedInYears !== undefined) {
      const cutoff = now - notWatchedInYears * 365.25 * DAY_MS;
      candidates = candidates.filter((g) => {
        const activity = lastActivity(g.kind, g.watch);
        if (activity === null) {
          undated++;
          return false;
        }
        return activity * 1000 < cutoff;
      });
    }

    const byTitle = (a: Group, b: Group) =>
      String(a.item.titleSort ?? a.item.title).localeCompare(String(b.item.titleSort ?? b.item.title)) || (a.item.year ?? 0) - (b.item.year ?? 0);
    // Newest / oldest first; a title with no date sorts last either way.
    const byDate = (pick: (g: Group) => number | null, newestFirst: boolean) => (a: Group, b: Group) => {
      const x = pick(a);
      const y = pick(b);
      if (x === null || y === null) return x === y ? byTitle(a, b) : x === null ? 1 : -1;
      return (newestFirst ? y - x : x - y) || byTitle(a, b);
    };
    const comparator =
      sort === "recentlyAdded" ? byDate((g) => g.watch.addedLast, true)
      : sort === "lastWatched" ? byDate((g) => g.watch.lastViewed, true)
      : sort === "leastRecentlyWatched" ? byDate((g) => lastActivity(g.kind, g.watch), false)
      : byTitle;
    const sorted = candidates.sort(comparator);
    const total = sorted.length;
    const rows = sorted.slice(offset, offset + limit);

    const withDates = Boolean(watched) || notWatchedInYears !== undefined || sort !== "title";
    const sortHeading = sort === "recentlyAdded" ? "newest additions first" : sort === "lastWatched" ? "most recently watched first" : sort === "leastRecentlyWatched" ? "longest unwatched first" : "";
    const heading = described.join(", ") || sortHeading || "that request";
    const undatedNote =
      undated > 0
        ? ` ${undated} title${undated === 1 ? " has" : "s have"} been watched but Plex holds no date for ${undated === 1 ? "it" : "them"}, so ${undated === 1 ? "it was" : "they were"} left out of the "not watched in ${notWatchedInYears} years" list because that can't be judged.`
        : "";
    if (rows.length === 0) {
      return textReply(
        total > 0
          ? `Offset ${offset} is past the end: there are only ${total} matching ${noun} for ${heading}.`
          : `No ${noun} in Plex match ${heading}.${undatedNote}`
      );
    }

    const movieCount = sorted.filter((g) => g.kind === "movie").length;
    const showCount = total - movieCount;
    const counted =
      movieCount > 0 && showCount > 0
        ? `${total} matching titles (${movieCount} movie${movieCount === 1 ? "" : "s"}, ${showCount} show${showCount === 1 ? "" : "s"})`
        : `${total} matching ${showCount > 0 ? "show" : "movie"}${total === 1 ? "" : "s"}`;

    const shownEnd = offset + rows.length;
    let output = `## Plex library: ${heading}\n`;
    output += counted;
    if (total > rows.length) output += `, listed ${offset + 1}-${shownEnd}`;
    output += ".";
    if (total > shownEnd) {
      output += ` ${total - shownEnd} more are not listed: call again with offset ${shownEnd} for the next page (limit up to ${MAX_LIMIT}).`;
    }
    output += " Each line is one title with every Plex library that holds it; the user sees the same titles in a table below your reply.";
    if (watched || notWatchedInYears !== undefined || sort === "lastWatched" || sort === "leastRecentlyWatched") {
      output += " Watch state is for the Plex account the app is connected with.";
    }
    output += undatedNote;
    output += "\n\n";
    for (const { kind, item, libraries, watch } of rows) {
      const genres = (item.Genre ?? []).map((g: any) => g.tag).join(", ");
      const kindNote = kind === "show" ? `TV show, ${showSummary(item.childCount, watch)}, ` : "";
      const watchNote = withDates ? ` - ${watchNoteOf(kind, watch, sort === "recentlyAdded")}` : "";
      output += `- ${item.title} (${item.year ?? "year unknown"}) - ${kindNote}${libraries.join(", ")}${genres ? ` - ${genres}` : ""}${watchNote}\n`;
    }

    const media: MediaRow[] = rows.map(({ kind, item, libraries, watch }) => {
      const rating = item.audienceRating ?? item.rating;
      const row: MediaRow = {
        kind,
        title: String(item.title),
        year: item.year ?? null,
        posterUrl: plexPosterUrl(item.thumb),
        libraries,
        genres: (item.Genre ?? []).map((g: any) => String(g.tag)),
        rating: rating !== undefined ? Number(rating) : null,
        detail: null,
      };
      if (kind === "show") {
        row.show = {
          seasons: numberOrNull(item.childCount),
          episodes: watch.leaf,
          watchedEpisodes: watch.seen,
          network: typeof item.studio === "string" && item.studio ? item.studio : null,
        };
      }
      if (withDates) {
        row.lastWatched = lastWatchedLabel(kind, watch);
        row.added = isoDay(watch.addedLast);
      }
      return row;
    });

    // append: this page continues the previous one (offset > 0) rather than replacing it.
    return { ...textReply(output), structuredContent: { media, append: offset > 0 } };
  } catch (error: unknown) {
    return textReply(`Failed to search Plex: ${getErrorMessage(error)}`, true);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// What Plex records about watching one title, merged across the libraries that
// hold it. Watch state is per library item, so an HD and a 4K copy can differ:
// the title counts as far as its furthest-watched copy got.
interface Watch {
  viewCount: number;
  viewOffset: number;
  duration: number | null;
  // Shows: episodes held and episodes watched, from the furthest-watched copy.
  leaf: number | null;
  seen: number;
  // Epoch seconds.
  lastViewed: number | null;
  addedFirst: number | null;
  addedLast: number | null;
}

const count = (value: unknown): number => numberOrNull(value) ?? 0;
const latest = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
const earliest = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

function watchOf(item: any, kind: MediaKind): Watch {
  return {
    viewCount: count(item.viewCount),
    viewOffset: count(item.viewOffset),
    duration: numberOrNull(item.duration),
    leaf: kind === "show" ? numberOrNull(item.leafCount) : null,
    seen: kind === "show" ? count(item.viewedLeafCount) : 0,
    lastViewed: numberOrNull(item.lastViewedAt),
    addedFirst: numberOrNull(item.addedAt),
    addedLast: numberOrNull(item.addedAt),
  };
}

function mergeWatch(a: Watch, b: Watch): Watch {
  const furthest = b.seen > a.seen || (b.seen === a.seen && (b.leaf ?? 0) > (a.leaf ?? 0)) ? b : a;
  return {
    viewCount: Math.max(a.viewCount, b.viewCount),
    viewOffset: Math.max(a.viewOffset, b.viewOffset),
    duration: a.duration ?? b.duration,
    leaf: furthest.leaf,
    seen: furthest.seen,
    lastViewed: latest(a.lastViewed, b.lastViewed),
    addedFirst: earliest(a.addedFirst, b.addedFirst),
    addedLast: latest(a.addedLast, b.addedLast),
  };
}

const showFinished = (w: Watch) => w.seen > 0 && w.leaf !== null && w.seen >= w.leaf;

function matchesWatch(kind: MediaKind, w: Watch, want: WatchFilter): boolean {
  if (kind === "movie") {
    if (want === "unwatched") return w.viewCount === 0 && w.viewOffset === 0;
    if (want === "inProgress") return w.viewOffset > 0;
    return w.viewCount > 0;
  }
  if (want === "unwatched") return w.seen === 0;
  if (want === "watched") return showFinished(w);
  return w.seen > 0 && !showFinished(w);
}

const everWatched = (kind: MediaKind, w: Watch) => (kind === "movie" ? w.viewCount > 0 || w.viewOffset > 0 : w.seen > 0);

// When someone last did something with the title, in epoch seconds: the last
// time it was watched, or for a never-watched title when it was added. Null
// when Plex says it was watched but not when.
function lastActivity(kind: MediaKind, w: Watch): number | null {
  if (w.lastViewed !== null) return w.lastViewed;
  return everWatched(kind, w) ? null : w.addedFirst;
}

const isoDay = (seconds: number | null): string | null => (seconds === null ? null : new Date(seconds * 1000).toISOString().slice(0, 10));

function lastWatchedLabel(kind: MediaKind, w: Watch): string | null {
  if (w.lastViewed !== null) return isoDay(w.lastViewed);
  return everWatched(kind, w) ? "date unknown" : null;
}

// "unwatched", "watched 2026-02-21", "in progress (20%), last watched ..." for the model's list.
function watchNoteOf(kind: MediaKind, w: Watch, showAdded: boolean): string {
  const parts: string[] = [];
  if (!everWatched(kind, w)) {
    parts.push("unwatched");
  } else {
    const date = w.lastViewed !== null ? isoDay(w.lastViewed) : null;
    if (kind === "movie" && w.viewOffset > 0) {
      const percent = w.duration ? Math.min(99, Math.round((w.viewOffset / w.duration) * 100)) : null;
      parts.push(`in progress${percent !== null ? ` (${percent}%)` : ""}${date ? `, last watched ${date}` : ""}`);
    } else if (kind === "movie") {
      parts.push(date ? `watched ${date}` : "watched, date unknown");
    } else {
      parts.push(date ? `last watched ${date}` : "watched, date unknown");
    }
  }
  if (showAdded && w.addedLast !== null) parts.push(`added ${isoDay(w.addedLast)}`);
  return parts.join(", ");
}

// "5 seasons, 62 episodes (40 watched)" for the model's text list.
function showSummary(seasons: unknown, w: Watch): string {
  const seasonCount = numberOrNull(seasons);
  const parts: string[] = [];
  if (seasonCount !== null) parts.push(`${seasonCount} season${seasonCount === 1 ? "" : "s"}`);
  if (w.leaf !== null) parts.push(`${w.leaf} episode${w.leaf === 1 ? "" : "s"} (${w.seen} watched)`);
  return parts.join(", ") || "size unknown";
}

// Every movie (or show) Plex holds, keyed by TMDb id -> the libraries that hold
// it. Matching on TMDb id (rather than filtering by actor tag) is exact: Plex
// only tags an actor on the cast it lists, so a tag filter would call a minor
// role "not owned". The movie index is ~1,400 titles / a few MB, so each kind
// is cached briefly instead of re-fetched for every question. TMDb movie and TV
// ids are separate id spaces, hence one index per kind. A show Plex has no TMDb
// id for is not in the show index (TMDb credits carry no TVDB id to match by).
// Unlike searches, the index ignores the "libraries to skip" setting: a title
// in a skipped library is still owned.
const OWNED_INDEX_TTL_MS = 5 * 60_000;
const INDEX_PAGE_SIZE = 1000;
const ownedIndexCache: Partial<Record<MediaKind, { at: number; byTmdbId: Map<string, string[]> }>> = {};

export async function getOwnedTmdbIndex(kind: MediaKind = "movie"): Promise<Map<string, string[]>> {
  const cached = ownedIndexCache[kind];
  if (cached && Date.now() - cached.at < OWNED_INDEX_TTL_MS) {
    return cached.byTmdbId;
  }

  const sections = await getSections([kind]);
  const byTmdbId = new Map<string, string[]>();

  await Promise.all(
    sections.map(async (section) => {
      for (let start = 0; ; start += INDEX_PAGE_SIZE) {
        const response = await plexClient.get(`/library/sections/${section.key}/all`, {
          params: { includeGuids: 1, "X-Plex-Container-Start": start, "X-Plex-Container-Size": INDEX_PAGE_SIZE },
        });
        const container = response.data?.MediaContainer ?? {};
        const items: any[] = container.Metadata ?? [];
        for (const item of items) {
          const tmdbId = tmdbIdOf(item);
          if (!tmdbId) continue;
          const libraries = byTmdbId.get(tmdbId) ?? [];
          libraries.push(section.title);
          byTmdbId.set(tmdbId, libraries);
        }
        if (items.length === 0 || start + items.length >= Number(container.totalSize ?? 0)) break;
      }
    })
  );

  ownedIndexCache[kind] = { at: Date.now(), byTmdbId };
  return byTmdbId;
}

// For tests: forget the cached indexes so the next call re-reads Plex.
export function resetOwnedTmdbIndexCache(): void {
  delete ownedIndexCache.movie;
  delete ownedIndexCache.show;
}

export interface OnDeckArgs {
  // Only movies, only shows (their next episodes), or both (the default).
  mediaType?: "movie" | "show" | "any";
  // Only titles from libraries whose name contains this text (case-insensitive).
  library?: string;
  // Only a movie or show whose title contains this text (case-insensitive).
  title?: string;
  limit?: number;
}

const DEFAULT_DECK_LIMIT = 10;
// Plex reports at most this many On Deck items.
const MAX_DECK_LIMIT = 50;

// Plex's "Continue Watching": for shows the episode to watch next (or the one
// half watched), for movies the ones partly played, most recent first. Answers
// "what should I watch next?". Like the watch filters in searchPlexLibrary it
// is for the Plex account the app is connected with. A title held in HD and 4K
// shows up once per library in Plex; here it is one entry listing both.
export async function getOnDeck(args: OnDeckArgs = {}) {
  if (!isConfigured("PLEX")) {
    return textReply("Plex isn't configured. Set the Plex URL and token on the Settings page (or PLEX_URL / PLEX_TOKEN in .env).", true);
  }
  const mediaType = args.mediaType ?? "any";
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? DEFAULT_DECK_LIMIT), 1), MAX_DECK_LIMIT);

  try {
    const response = await plexClient.get("/library/onDeck", { params: { "X-Plex-Container-Start": 0, "X-Plex-Container-Size": MAX_DECK_LIMIT } });
    const raw: any[] = (response.data?.MediaContainer?.Metadata ?? []).filter((item: any) => item.type === "episode" || item.type === "movie");
    const kindOf = (item: any): MediaKind => (item.type === "episode" ? "show" : "movie");

    let items = raw.filter((item) => mediaType === "any" || kindOf(item) === mediaType);
    if (args.library) {
      const wanted = args.library.trim().toLowerCase();
      const present = [...new Set(items.map((item) => String(item.librarySectionTitle ?? "")).filter(Boolean))];
      items = items.filter((item) => String(item.librarySectionTitle ?? "").toLowerCase().includes(wanted));
      if (items.length === 0) {
        return textReply(`Nothing on deck in a library matching "${args.library}". Libraries with something on deck: ${present.join(", ") || "none"}.`);
      }
    }

    if (args.title?.trim()) {
      const wanted = args.title.trim().toLowerCase();
      items = items.filter((item) => String(kindOf(item) === "show" ? item.grandparentTitle : item.title).toLowerCase().includes(wanted));
      if (items.length === 0) {
        return textReply(`Nothing on deck matches "${args.title}". Plex lists a show here only once it has been started and has an episode left to watch, and a movie only while it is part way through.`);
      }
    }

    // One entry per movie or show, however many libraries hold it.
    interface Entry {
      item: any;
      kind: MediaKind;
      libraries: string[];
    }
    const entries: Entry[] = [];
    const byTitle = new Map<string, Entry>();
    for (const item of items) {
      const kind = kindOf(item);
      const key = kind === "show" ? `show:${item.grandparentGuid ?? item.grandparentTitle}` : `movie:${item.guid ?? `${item.title}|${item.year}`}`;
      const library = String(item.librarySectionTitle ?? "");
      const existing = byTitle.get(key);
      if (existing) {
        if (library && !existing.libraries.includes(library)) existing.libraries.push(library);
      } else {
        const entry: Entry = { item, kind, libraries: library ? [library] : [] };
        entries.push(entry);
        byTitle.set(key, entry);
      }
    }

    const noun = mediaType === "any" ? "movies or shows" : `${mediaType}s`;
    if (entries.length === 0) {
      return textReply(`Nothing is on deck in Plex${mediaType === "any" ? "" : ` for ${noun}`}.`);
    }

    const listed = entries.slice(0, limit);
    const describe = ({ item, kind }: Entry) => {
      const played = numberOrNull(item.viewOffset) ?? 0;
      const duration = numberOrNull(item.duration);
      const percent = played > 0 && duration ? Math.min(99, Math.round((played / duration) * 100)) : null;
      const date = isoDay(numberOrNull(item.lastViewedAt));
      const state = played > 0 ? `${percent !== null ? `${percent}% watched` : "partly watched"}${date ? `, last watched ${date}` : ""}` : `next up${date ? `, last activity ${date}` : ""}`;
      const episode = kind === "show" ? `S${item.parentIndex}E${String(item.index).padStart(2, "0")}${item.title ? ` "${item.title}"` : ""}` : null;
      return { played, date, state, episode };
    };

    let output = `## On deck in Plex (the "continue watching" list): ${entries.length} ${entries.length === 1 ? "item" : "items"}\n`;
    output += "Most recently active first. Each line is one movie, or the next episode of one show; the user sees the same list in a table below your reply. This is Plex's short On Deck list (at most 50 recent items), NOT every unfinished title: for a complete list of what is unwatched or unfinished use search_plex_library with its watched filter. Watch state is for the Plex account the app is connected with.\n";
    if (entries.length > listed.length) output += `Listed the first ${listed.length}; ${entries.length - listed.length} more are not listed (limit up to ${MAX_DECK_LIMIT}).\n`;
    output += "\n";
    for (const entry of listed) {
      const { item, kind, libraries } = entry;
      const { state, episode } = describe(entry);
      const name = kind === "show" ? `${item.grandparentTitle ?? "Unknown show"} ${episode}` : `${item.title}${item.year ? ` (${item.year})` : ""}`;
      output += `- ${name} - ${libraries.join(", ")} - ${state}\n`;
    }

    const media: MediaRow[] = listed.map((entry) => {
      const { item, kind, libraries } = entry;
      const { played, date, state, episode } = describe(entry);
      const row: MediaRow = {
        kind,
        title: String(kind === "show" ? (item.grandparentTitle ?? "Unknown show") : item.title),
        year: kind === "movie" && typeof item.year === "number" ? item.year : null,
        posterUrl: plexPosterUrl(kind === "show" ? (item.grandparentThumb ?? item.thumb) : item.thumb),
        libraries,
        genres: [],
        rating: null,
        detail: kind === "show" ? `${episode} - ${state}` : state,
      };
      if (played > 0 && date) row.lastWatched = date;
      return row;
    });

    return { ...textReply(output), structuredContent: { media, append: false } };
  } catch (error: unknown) {
    return textReply(`Failed to read On Deck from Plex: ${getErrorMessage(error)}`, true);
  }
}
