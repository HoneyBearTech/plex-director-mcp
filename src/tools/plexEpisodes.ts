import { plexClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";
import { findSeries } from "./series.js";
import { getSections, isoDay, numberOrNull, plexPosterUrl, skippedLibraryNames, type MediaRow } from "./plex.js";

// Episode-level search in Plex. Plex can filter episodes by title and air date
// on the server but cannot search their summaries, so:
//  - with a show named, that show's episodes are read (fast) and searched here,
//    by title AND plot summary;
//  - without one, only the episode TITLE and air date can be searched, using
//    Plex's own filters. (Searching every summary in the library would mean
//    reading ~20,000 episodes, ~57 MB, per question.)

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;
const SNIPPET = 130;

export interface EpisodeSearchArgs {
  // A show to search inside. Enables plot (summary) search.
  show?: string;
  // Words that must all appear in the episode title (and, with a show, its plot).
  text?: string;
  season?: number;
  episode?: number;
  // YYYY-MM-DD, inclusive.
  airedFrom?: string;
  airedTo?: string;
  // Season premieres (episode 1), or season finales (needs a show).
  episodeType?: "premiere" | "finale";
  // Library-wide only: libraries whose name contains this text.
  library?: string;
  limit?: number;
}

interface Ep {
  show: string;
  season: number;
  number: number;
  title: string;
  summary: string;
  aired: string | null;
  viewCount: number;
  lastViewed: number | null;
  libraries: string[];
  poster: string | null;
  showYear: number | null;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toEp(item: any, library: string): Ep {
  return {
    show: String(item.grandparentTitle ?? "Unknown show"),
    season: Number(item.parentIndex ?? 0),
    number: Number(item.index ?? 0),
    title: String(item.title ?? ""),
    summary: String(item.summary ?? ""),
    aired: typeof item.originallyAvailableAt === "string" ? item.originallyAvailableAt.slice(0, 10) : null,
    viewCount: numberOrNull(item.viewCount) ?? 0,
    lastViewed: numberOrNull(item.lastViewedAt),
    libraries: [library],
    poster: plexPosterUrl(item.grandparentThumb ?? item.thumb),
    showYear: null,
  };
}

// One entry per show/season/episode, however many libraries hold it.
function merge(eps: Ep[]): Ep[] {
  const byKey = new Map<string, Ep>();
  for (const ep of eps) {
    const key = `${norm(ep.show)}|${ep.season}|${ep.number}`;
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, { ...ep, libraries: [...ep.libraries] });
    else {
      for (const l of ep.libraries) if (!existing.libraries.includes(l)) existing.libraries.push(l);
      existing.viewCount = Math.max(existing.viewCount, ep.viewCount);
      existing.lastViewed = Math.max(existing.lastViewed ?? 0, ep.lastViewed ?? 0) || null;
    }
  }
  return [...byKey.values()];
}

const words = (text: string | undefined) => (text ? norm(text).split(" ").filter(Boolean) : []);
const hasAll = (haystack: string, needles: string[]) => needles.every((w) => haystack.includes(w));

const code = (ep: Ep) => `S${ep.season}E${String(ep.number).padStart(2, "0")}`;
const snippet = (summary: string) => (summary.length > SNIPPET ? `${summary.slice(0, SNIPPET - 1).trimEnd()}…` : summary);
const watchNote = (ep: Ep) => (ep.viewCount > 0 ? `watched${ep.lastViewed ? ` ${isoDay(ep.lastViewed)}` : ""}` : "unwatched");

function present(eps: Ep[], total: number, limit: number, heading: string, showPlot: boolean, note: string) {
  const listed = eps.slice(0, limit);
  let output = `## ${heading}\n${total} matching episode${total === 1 ? "" : "s"}`;
  if (total > listed.length) output += `, listed the first ${listed.length} (raise limit up to ${MAX_LIMIT} or narrow the search)`;
  output += `. Each line is one episode; the user sees the same list in a table below your reply. Watch state is for the Plex account the app is connected with.${note}\n\n`;
  for (const ep of listed) {
    output += `- ${ep.show} ${code(ep)} "${ep.title}" - ${ep.aired ? `aired ${ep.aired}` : "no air date"} - ${watchNote(ep)} - ${ep.libraries.join(", ")}${showPlot && ep.summary ? ` - plot: ${snippet(ep.summary)}` : ""}\n`;
  }
  const media: MediaRow[] = listed.map((ep) => ({
    kind: "show",
    title: ep.show,
    year: null,
    posterUrl: ep.poster,
    libraries: ep.libraries,
    genres: [],
    rating: null,
    detail: `${code(ep)} "${ep.title}" - ${ep.aired ?? "no air date"} - ${watchNote(ep)}${showPlot && ep.summary ? ` - ${snippet(ep.summary)}` : ""}`,
  }));
  return { ...textReply(output), structuredContent: { media, append: false } };
}

export async function searchEpisodes(args: EpisodeSearchArgs = {}) {
  if (!isConfigured("PLEX")) {
    return textReply("Plex isn't configured. Set the Plex URL and token on the Settings page (or PLEX_URL / PLEX_TOKEN in .env).", true);
  }
  const { show, season, episode, airedFrom, airedTo, episodeType } = args;
  const needles = words(args.text);
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

  for (const [name, value] of [["airedFrom", airedFrom], ["airedTo", airedTo]] as const) {
    if (value !== undefined && !DATE.test(value)) return textReply(`${name} must be a date like 2026-09-01.`, true);
  }
  if (airedFrom && airedTo && airedFrom > airedTo) return textReply("airedFrom is after airedTo.", true);
  if (episode !== undefined && season === undefined) return textReply("To find one episode number, give its season as well.", true);
  if (!show && episodeType === "finale") return textReply("Season finales can only be found within one show: name the show.", true);
  if (!show && needles.length === 0 && !airedFrom && !airedTo) {
    return textReply("Name a show, or give words for the episode title (searches every show's titles) or an air-date range.", true);
  }

  try {
    const sections = await getSections(["show"]);
    if (sections.length === 0) return textReply("No show libraries found in Plex.", true);
    return show ? await withinShow(sections, show, args, needles, limit) : await libraryWide(sections, args, needles, limit);
  } catch (error: unknown) {
    return textReply(`Failed to search Plex episodes: ${getErrorMessage(error)}`, true);
  }
}

async function withinShow(sections: Awaited<ReturnType<typeof getSections>>, show: string, args: EpisodeSearchArgs, needles: string[], limit: number) {
  // Find the show in every library (a show can be in HD and 4K).
  const found = await Promise.all(
    sections.map(async (section) => {
      const response = await plexClient.get(`/library/sections/${section.key}/all`, { params: { type: 2, title: show } });
      return ((response.data?.MediaContainer?.Metadata ?? []) as any[]).map((item) => ({ item, library: section.title }));
    })
  );
  const groups = new Map<string, { title: string; year: number | null; alternateTitles: never[]; copies: Array<{ ratingKey: string; library: string }> }>();
  for (const { item, library } of found.flat()) {
    const key = String(item.guid ?? `${item.title}|${item.year}`);
    const group = groups.get(key) ?? { title: String(item.title), year: numberOrNull(item.year), alternateTitles: [], copies: [] };
    group.copies.push({ ratingKey: String(item.ratingKey), library });
    groups.set(key, group);
  }
  const lookup = findSeries([...groups.values()], show);
  if (!lookup) return textReply(`No show matching "${show}" in Plex.`);
  if ("candidates" in lookup) {
    return textReply(`"${show}" matches several shows in Plex: ${lookup.candidates.slice(0, 10).map((c: any) => (c.year ? `${c.title} (${c.year})` : c.title)).join("; ")}. Ask again with the full title.`);
  }
  const chosen = lookup.series as { title: string; copies: Array<{ ratingKey: string; library: string }> };

  const leaves = await Promise.all(
    chosen.copies.map(async (copy) => {
      const response = await plexClient.get(`/library/metadata/${copy.ratingKey}/allLeaves`);
      return ((response.data?.MediaContainer?.Metadata ?? []) as any[]).map((item) => toEp(item, copy.library));
    })
  );
  const all = merge(leaves.flat()).filter((ep) => ep.season > 0);
  const lastOfSeason = new Map<number, number>();
  for (const ep of all) lastOfSeason.set(ep.season, Math.max(lastOfSeason.get(ep.season) ?? 0, ep.number));

  const { season, episode, airedFrom, airedTo, episodeType } = args;
  const matches = all
    .filter((ep) => (season === undefined || ep.season === season) && (episode === undefined || ep.number === episode))
    .filter((ep) => !airedFrom || (ep.aired !== null && ep.aired >= airedFrom))
    .filter((ep) => !airedTo || (ep.aired !== null && ep.aired <= airedTo))
    .filter((ep) => episodeType !== "premiere" || ep.number === 1)
    .filter((ep) => episodeType !== "finale" || ep.number === lastOfSeason.get(ep.season))
    .map((ep) => ({ ep, inTitle: hasAll(norm(ep.title), needles), inText: hasAll(norm(`${ep.title} ${ep.summary}`), needles) }))
    .filter(({ inText }) => inText);
  // Title matches first, then plot-only matches; each in season/episode order.
  matches.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || a.ep.season - b.ep.season || a.ep.number - b.ep.number);

  const parts = [args.text ? `"${args.text}" in titles and plots` : "", season !== undefined ? `season ${season}` : "", episode !== undefined ? `episode ${episode}` : "", airedFrom || airedTo ? `aired ${airedFrom ?? "any"} to ${airedTo ?? "any"}` : "", episodeType ? `season ${episodeType}s` : ""].filter(Boolean);
  const heading = `${chosen.title} episodes${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
  if (matches.length === 0) return textReply(`No episodes of ${chosen.title} in Plex match${parts.length > 0 ? ` ${parts.join(", ")}` : ""}. Plex holds ${all.length} episode${all.length === 1 ? "" : "s"} of it.`);
  return present(matches.map((m) => m.ep), matches.length, limit, heading, needles.length > 0, "");
}

async function libraryWide(sections: Awaited<ReturnType<typeof getSections>>, args: EpisodeSearchArgs, needles: string[], limit: number) {
  let searched = sections;
  if (args.library) {
    const wanted = args.library.trim().toLowerCase();
    searched = sections.filter((s) => s.title.toLowerCase().includes(wanted));
    if (searched.length === 0) return textReply(`No show library matching "${args.library}" in Plex. Libraries: ${sections.map((s) => s.title).join(", ")}.`, true);
  } else {
    const skipped = skippedLibraryNames();
    searched = sections.filter((s) => !skipped.has(s.title.toLowerCase()));
  }

  const { season, episode, airedFrom, airedTo, episodeType } = args;
  const perLibrary = await Promise.all(
    searched.map(async (section) => {
      const params: Record<string, string | number> = { type: 4, sort: "originallyAvailableAt:desc" };
      if (args.text) params.title = args.text;
      if (airedFrom) params["originallyAvailableAt>>"] = airedFrom;
      if (airedTo) params["originallyAvailableAt<<"] = airedTo;
      if (episode !== undefined) params.index = episode;
      else if (episodeType === "premiere") params.index = 1;
      const response = await plexClient.get(`/library/sections/${section.key}/all`, { params });
      return ((response.data?.MediaContainer?.Metadata ?? []) as any[]).map((item) => toEp(item, section.title));
    })
  );
  // Plex's filter matches any word order; require every word, in the title.
  const eps = merge(perLibrary.flat())
    .filter((ep) => ep.season > 0 && hasAll(norm(ep.title), needles))
    .filter((ep) => (season === undefined || ep.season === season) && (episode === undefined || ep.number === episode) && (episodeType !== "premiere" || ep.number === 1))
    .sort((a, b) => (b.aired ?? "").localeCompare(a.aired ?? "") || a.show.localeCompare(b.show) || a.season - b.season || a.number - b.number);

  const parts = [args.text ? `"${args.text}" in the episode title` : "", season !== undefined ? `season ${season}` : "", episode !== undefined ? `episode ${episode}` : "", airedFrom || airedTo ? `aired ${airedFrom ?? "any"} to ${airedTo ?? "any"}` : "", episodeType ? "season premieres" : ""].filter(Boolean);
  const heading = `Episodes: ${parts.join(", ")}`;
  if (eps.length === 0) return textReply(`No episodes in Plex match ${parts.join(", ")}.`);
  const note = needles.length > 0 ? " Only episode titles were searched (Plex cannot search plots across the library); to search plots, name the show." : "";
  return present(eps, eps.length, limit, heading, false, note);
}
