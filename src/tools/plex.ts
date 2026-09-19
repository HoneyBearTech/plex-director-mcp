import { plexClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";

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
  limit?: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

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

// Backslashes first: escaping only the pipe would let a trailing "\\" in a
// title cancel out the pipe's escape and break the table row.
function plexPosterUrl(thumb: unknown): string | null {
  return typeof thumb === "string" && thumb ? `/api/plex/image?path=${encodeURIComponent(thumb)}` : null;
}

function cell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

// Movies actually in the Plex library, filtered by any combination of genre,
// actor, title, and year. Complements check_movie_status (Radarr - what's
// managed) and the TMDb tools (what exists) with "what can I actually watch".
export async function searchPlexLibrary(args: PlexSearchArgs) {
  if (!isConfigured("PLEX")) {
    return textReply("Plex isn't configured. Set the Plex URL and token on the Settings page (or PLEX_URL / PLEX_TOKEN in .env).", true);
  }

  const { title, genre, actor, year } = args;
  if (!title && !genre && !actor && year === undefined) {
    return textReply("Provide at least one of: title, genre, actor, year.", true);
  }
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  try {
    const sections = await getMovieSections();
    if (sections.length === 0) {
      return textReply("No movie libraries found in Plex.", true);
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
    if (genre) {
      const resolved = await resolveGenre(genre, sections);
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
            "X-Plex-Container-Size": limit,
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
      .slice(0, limit);

    const heading = described.join(", ");
    if (rows.length === 0) {
      return textReply(`No movies in Plex match ${heading}.`);
    }

    let output = `## Plex library: ${heading}\n`;
    output += `${total} match${total === 1 ? "" : "es"}${total > rows.length ? ` (showing ${rows.length})` : ""}. Every row below matches all of the filters; the same movie appears once per library that holds it.\n\n`;
    output += "| Title | Year | Library | Genres | Rating | TMDb ID |\n";
    output += "| :--- | :---: | :--- | :--- | :---: | :---: |\n";
    for (const { item, library } of rows) {
      const genres = (item.Genre ?? []).map((g: any) => g.tag).join(", ");
      const rating = item.audienceRating ?? item.rating;
      output += `| ${cell(String(item.title))} | ${item.year ?? "N/A"} | ${cell(library)} | ${cell(genres)} | ${rating !== undefined ? Number(rating).toFixed(1) : "N/A"} | ${tmdbIdOf(item) ?? "N/A"} |\n`;
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

    return { ...textReply(output), structuredContent: { movies } };
  } catch (error: unknown) {
    return textReply(`Failed to search Plex: ${getErrorMessage(error)}`, true);
  }
}
