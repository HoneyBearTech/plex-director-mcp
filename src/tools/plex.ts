import { plexClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage, escapeTableCell } from "../util.js";

// One movie in a result list. Tools attach these as structuredContent so the
// web UI can render a table with posters; the text reply stays for MCP clients
// and for the model. posterUrl is always something the browser can load
// directly (a same-origin proxy URL or a public image URL), never a raw Plex
// URL, which would need the token.
export interface MovieRow {
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
}

export interface PlexSearchArgs {
  title?: string;
  genre?: string;
  actor?: string;
  year?: number;
  // Only libraries whose name contains this text (case-insensitive), e.g. "4k".
  library?: string;
  limit?: number;
  // How many matches to skip, for paging through a large result.
  offset?: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;
// The model reads the text reply, so it lists only this many rows; the full
// set (up to `limit`) still goes to the UI table as structured rows.
const TEXT_ROW_CAP = 100;

interface PlexSection {
  key: string;
  title: string;
}

// A server can have several movie libraries (e.g. HD, 4K, kids, documentaries);
// a "movie I own" question has to look across all of them.
async function getMovieSections(): Promise<PlexSection[]> {
  const response = await plexClient.get("/library/sections");
  const directories: any[] = response.data?.MediaContainer?.Directory ?? [];
  return directories
    .filter((d) => d.type === "movie")
    .map((d) => ({ key: String(d.key), title: String(d.title) }));
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

function tmdbIdOf(item: any): string | null {
  const guid = (item.Guid ?? []).find((g: any) => typeof g.id === "string" && g.id.startsWith("tmdb://"));
  return guid ? guid.id.slice("tmdb://".length) : null;
}

function plexPosterUrl(thumb: unknown): string | null {
  return typeof thumb === "string" && thumb ? `/api/plex/image?path=${encodeURIComponent(thumb)}` : null;
}

// Movies actually in the Plex library, filtered by any combination of genre,
// actor, title, and year. Complements check_movie_status (Radarr - what's
// managed) and the TMDb tools (what exists) with "what can I actually watch".
export async function searchPlexLibrary(args: PlexSearchArgs) {
  if (!isConfigured("PLEX")) {
    return textReply("Plex isn't configured. Set the Plex URL and token on the Settings page (or PLEX_URL / PLEX_TOKEN in .env).", true);
  }

  const { title, genre, actor, year, library } = args;
  if (!title && !genre && !actor && year === undefined && !library) {
    return textReply("Provide at least one of: title, genre, actor, year, library.", true);
  }
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(args.offset ?? 0, 0);

  try {
    const allSections = await getMovieSections();
    if (allSections.length === 0) {
      return textReply("No movie libraries found in Plex.", true);
    }

    // Genre and actor ids are server-wide, so they're resolved against every
    // library; only the search itself is narrowed by the library filter.
    let sections = allSections;
    if (library) {
      const wanted = library.trim().toLowerCase();
      sections = allSections.filter((s) => s.title.toLowerCase().includes(wanted));
      if (sections.length === 0) {
        return textReply(`No movie library matching "${library}" in Plex. Movie libraries: ${allSections.map((s) => s.title).join(", ")}.`, true);
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

    const perSection = await Promise.all(
      sections.map(async (section) => {
        const response = await plexClient.get(`/library/sections/${section.key}/all`, {
          params: {
            ...filters,
            includeGuids: 1,
            "X-Plex-Container-Start": 0,
            // Enough from each library to cover this page after merging.
            "X-Plex-Container-Size": offset + limit,
          },
        });
        const container = response.data?.MediaContainer ?? {};
        const items: any[] = container.Metadata ?? [];
        return {
          section,
          total: Number(container.totalSize ?? items.length),
          items,
        };
      })
    );

    const total = perSection.reduce((sum, r) => sum + r.total, 0);
    const rows = perSection
      .flatMap((r) => r.items.map((item) => ({ item, library: r.section.title })))
      .sort((a, b) => String(a.item.titleSort ?? a.item.title).localeCompare(String(b.item.titleSort ?? b.item.title)) || (a.item.year ?? 0) - (b.item.year ?? 0))
      .slice(offset, offset + limit);

    const heading = described.join(", ");
    if (rows.length === 0) {
      return textReply(
        total > 0
          ? `Offset ${offset} is past the end: there are only ${total} matches for ${heading}.`
          : `No movies in Plex match ${heading}.`
      );
    }

    const shownEnd = offset + rows.length;
    let output = `## Plex library: ${heading}\n`;
    output += `${total} match${total === 1 ? "" : "es"}`;
    if (total > rows.length) output += ` (showing ${offset + 1}-${shownEnd})`;
    output += `. Every row matches all of the filters; the same movie appears once per library that holds it.`;
    // The distinct count is only knowable when every match is in hand, and the
    // model shouldn't have to work it out (it guessed wrong when left to).
    if (offset === 0 && total === rows.length) {
      const distinct = new Set(rows.map(({ item }) => tmdbIdOf(item) ?? `${item.title}|${item.year}`)).size;
      if (distinct < rows.length) {
        output += ` That is ${distinct} distinct movies: ${rows.length - distinct} of the ${rows.length} rows repeat a movie that is also held in another library.`;
      }
    }
    if (total > shownEnd) {
      output += ` ${total - shownEnd} more not shown: call again with offset ${shownEnd} for the next page (limit up to ${MAX_LIMIT}).`;
    }
    output += "\n";
    if (rows.length > TEXT_ROW_CAP) {
      output += `The user's table already shows all ${rows.length} rows; only the first ${TEXT_ROW_CAP} are listed below to save space. The rest are on the user's screen, so do not request them again.\n`;
    }
    output += "\n";
    output += "| Title | Year | Library | Genres | Rating | TMDb ID |\n";
    output += "| :--- | :---: | :--- | :--- | :---: | :---: |\n";
    for (const { item, library: libraryName } of rows.slice(0, TEXT_ROW_CAP)) {
      const genres = (item.Genre ?? []).map((g: any) => g.tag).join(", ");
      const rating = item.audienceRating ?? item.rating;
      output += `| ${escapeTableCell(String(item.title))} | ${item.year ?? "N/A"} | ${escapeTableCell(libraryName)} | ${escapeTableCell(genres)} | ${rating !== undefined ? Number(rating).toFixed(1) : "N/A"} | ${tmdbIdOf(item) ?? "N/A"} |\n`;
    }

    const movies: MovieRow[] = rows.map(({ item, library }) => {
      const rating = item.audienceRating ?? item.rating;
      return {
        title: String(item.title),
        year: item.year ?? null,
        posterUrl: plexPosterUrl(item.thumb),
        libraries: [library],
        genres: (item.Genre ?? []).map((g: any) => String(g.tag)),
        rating: rating !== undefined ? Number(rating) : null,
        detail: null,
      };
    });

    // append: this page continues the previous one (offset > 0) rather than replacing it.
    return { ...textReply(output), structuredContent: { movies, append: offset > 0 } };
  } catch (error: unknown) {
    return textReply(`Failed to search Plex: ${getErrorMessage(error)}`, true);
  }
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

  const sections = await getMovieSections();
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

