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
    network: string | null;
  };
}

export interface PlexSearchArgs {
  title?: string;
  genre?: string;
  actor?: string;
  year?: number;
  // Search movie libraries, show libraries, or both (the default).
  mediaType?: "movie" | "show" | "any";
  // Only libraries whose name contains this text (case-insensitive), e.g. "4k".
  library?: string;
  limit?: number;
  // How many matches to skip, for paging through a large result.
  offset?: number;
}

const DEFAULT_LIMIT = 25;
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
export async function searchPlexLibrary(args: PlexSearchArgs) {
  if (!isConfigured("PLEX")) {
    return textReply("Plex isn't configured. Set the Plex URL and token on the Settings page (or PLEX_URL / PLEX_TOKEN in .env).", true);
  }

  const { title, genre, actor, year, library } = args;
  const mediaType = args.mediaType ?? "any";
  if (!title && !genre && !actor && year === undefined && !library && mediaType === "any") {
    return textReply("Provide at least one of: title, genre, actor, year, library, mediaType.", true);
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
    }
    const groups: Group[] = [];
    const byKey = new Map<string, Group>();
    for (const { section, items } of perSection) {
      for (const item of items) {
        const keys = identityKeys(item, section.kind);
        const existing = keys.map((k) => byKey.get(k)).find((g) => g !== undefined);
        if (existing) {
          existing.libraries.push(section.title);
          for (const k of keys) byKey.set(k, existing);
        } else {
          const group: Group = { kind: section.kind, item, libraries: [section.title] };
          groups.push(group);
          for (const k of keys) byKey.set(k, group);
        }
      }
    }

    const sorted = groups.sort(
      (a, b) =>
        String(a.item.titleSort ?? a.item.title).localeCompare(String(b.item.titleSort ?? b.item.title)) ||
        (a.item.year ?? 0) - (b.item.year ?? 0)
    );
    const total = sorted.length;
    const rows = sorted.slice(offset, offset + limit);

    const heading = described.join(", ") || "that request";
    if (rows.length === 0) {
      return textReply(
        total > 0
          ? `Offset ${offset} is past the end: there are only ${total} matching ${noun} for ${heading}.`
          : `No ${noun} in Plex match ${heading}.`
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
    output += " Each line is one title with every Plex library that holds it; the user sees the same titles in a table below your reply.\n\n";
    for (const { kind, item, libraries } of rows) {
      const genres = (item.Genre ?? []).map((g: any) => g.tag).join(", ");
      const kindNote = kind === "show" ? `TV show, ${showSummary(item)}, ` : "";
      output += `- ${item.title} (${item.year ?? "year unknown"}) - ${kindNote}${libraries.join(", ")}${genres ? ` - ${genres}` : ""}\n`;
    }

    const media: MediaRow[] = rows.map(({ kind, item, libraries }) => {
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
          episodes: numberOrNull(item.leafCount),
          watchedEpisodes: numberOrNull(item.viewedLeafCount ?? 0),
          network: typeof item.studio === "string" && item.studio ? item.studio : null,
        };
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

// "5 seasons, 62 episodes (40 watched)" for the model's text list.
function showSummary(item: any): string {
  const seasons = numberOrNull(item.childCount);
  const episodes = numberOrNull(item.leafCount);
  const watched = numberOrNull(item.viewedLeafCount ?? 0);
  const parts: string[] = [];
  if (seasons !== null) parts.push(`${seasons} season${seasons === 1 ? "" : "s"}`);
  if (episodes !== null) parts.push(`${episodes} episode${episodes === 1 ? "" : "s"}${watched !== null ? ` (${watched} watched)` : ""}`);
  return parts.join(", ") || "size unknown";
}

// Every movie Plex holds, keyed by TMDb id -> the libraries that hold it.
// Matching on TMDb id (rather than filtering by actor tag) is exact: Plex only
// tags an actor on the cast it lists, so a tag filter would call a minor role
// "not owned". The whole index is ~1,400 movies / a few MB, so it's cached
// briefly instead of re-fetched for every question.
const OWNED_INDEX_TTL_MS = 5 * 60_000;
const INDEX_PAGE_SIZE = 1000;
let ownedIndexCache: { at: number; byTmdbId: Map<string, string[]> } | null = null;

export async function getOwnedTmdbIndex(): Promise<Map<string, string[]>> {
  if (ownedIndexCache && Date.now() - ownedIndexCache.at < OWNED_INDEX_TTL_MS) {
    return ownedIndexCache.byTmdbId;
  }

  const sections = await getSections(["movie"]);
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

  ownedIndexCache = { at: Date.now(), byTmdbId };
  return byTmdbId;
}

// For tests: forget the cached index so the next call re-reads Plex.
export function resetOwnedTmdbIndexCache(): void {
  ownedIndexCache = null;
}

