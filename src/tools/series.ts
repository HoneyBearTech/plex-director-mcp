import { sonarrClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";
import type { MediaRow } from "./plex.js";

// "Do I have every episode?" answered from Sonarr's episode list rather than
// its statistics. Sonarr's own counts only include episodes that are monitored
// and aired (or already downloaded), and most finished shows here are
// deliberately unmonitored - so the statistics call a partly downloaded show
// "100%" and /wanted/missing only covers monitored series. Counting aired
// regular episodes with and without a file gives the answer a person means.

export const NOT_CONFIGURED =
  "Sonarr isn't configured. Set the Sonarr URL and API key on the Settings page (or SONARR_URL / SONARR_API_KEY in .env).";

// Fetching every series' episodes is one request each; a handful at a time is
// fast (a few hundred series take about a second) without hammering Sonarr.
const EPISODE_FETCH_CONCURRENCY = 8;
const DEFAULT_GAP_LIMIT = 15;
const MAX_GAP_LIMIT = 200;
// A season with many separate holes is summarised, not listed exhaustively.
const MAX_RANGES_PER_SEASON = 8;
const MAX_SEASON_LINES = 40;

export interface SeasonStatus {
  season: number;
  // Episodes that have aired (or already have a file).
  released: number;
  have: number;
  // Episode numbers that have aired but have no file.
  missing: number[];
  // Not aired yet, or no air date.
  unaired: number;
}

export interface SeriesAnalysis {
  seasons: SeasonStatus[];
  released: number;
  have: number;
  missing: number;
  unaired: number;
  // Missing episodes Sonarr is set to look for (the episode is monitored).
  missingMonitored: number;
  // Season 0 ("Specials") is reported on its own and never counted as missing.
  specials: { total: number; have: number };
}

// An episode counts once it has aired, or if a file exists for it (a file means
// it is out, even if Sonarr has no air date). This matches how Sonarr counts.
function isReleased(episode: any, now: number): boolean {
  if (episode.hasFile) return true;
  const aired = episode.airDateUtc ? Date.parse(episode.airDateUtc) : NaN;
  return Number.isFinite(aired) && aired <= now;
}

export function analyzeEpisodes(episodes: any[], now: number = Date.now()): SeriesAnalysis {
  const bySeason = new Map<number, SeasonStatus>();
  const specials = { total: 0, have: 0 };
  let missingMonitored = 0;

  for (const episode of episodes) {
    const seasonNumber = Number(episode.seasonNumber);
    if (seasonNumber === 0) {
      specials.total++;
      if (episode.hasFile) specials.have++;
      continue;
    }
    let season = bySeason.get(seasonNumber);
    if (!season) {
      season = { season: seasonNumber, released: 0, have: 0, missing: [], unaired: 0 };
      bySeason.set(seasonNumber, season);
    }
    if (!isReleased(episode, now)) {
      season.unaired++;
      continue;
    }
    season.released++;
    if (episode.hasFile) {
      season.have++;
    } else {
      season.missing.push(Number(episode.episodeNumber));
      if (episode.monitored) missingMonitored++;
    }
  }

  const seasons = [...bySeason.values()].sort((a, b) => a.season - b.season);
  for (const season of seasons) season.missing.sort((a, b) => a - b);
  const sum = (pick: (s: SeasonStatus) => number) => seasons.reduce((total, s) => total + pick(s), 0);
  return {
    seasons,
    released: sum((s) => s.released),
    have: sum((s) => s.have),
    missing: sum((s) => s.missing.length),
    unaired: sum((s) => s.unaired),
    missingMonitored,
    specials,
  };
}

// [4, 5, 6, 9] -> "E4-E6, E9", shortened when there are many separate holes.
export function episodeRanges(numbers: number[]): string {
  const ranges: string[] = [];
  for (let i = 0; i < numbers.length; ) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j]! + 1) j++;
    ranges.push(j > i ? `E${numbers[i]}-E${numbers[j]}` : `E${numbers[i]}`);
    i = j + 1;
  }
  if (ranges.length <= MAX_RANGES_PER_SEASON) return ranges.join(", ");
  return `${ranges.slice(0, MAX_RANGES_PER_SEASON).join(", ")} and ${ranges.length - MAX_RANGES_PER_SEASON} more gaps`;
}

// Lowercase, "&" as "and", no accents or punctuation, and no trailing "(2014)":
// Sonarr sometimes puts the year in the title and people rarely type it.
// Apostrophes and periods vanish ("Marvel's" = "Marvels", "S.H.I.E.L.D." =
// "SHIELD"); any other punctuation separates words.
function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['\u2019.]/g, "")
    .replace(/&/g, " and ")
    .replace(/\(\d{4}\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "Title (2018)"; Sonarr sometimes already has the year in the title.
export const label = (series: any) => {
  const title = String(series.title);
  return series.year && !/\(\d{4}\)\s*$/.test(title) ? `${title} (${series.year})` : title;
};

export type SeriesLookup = { series: any } | { candidates: any[] } | null;

// Exact title (or alternate title) first, then a title that contains the text.
// One match is used; several are returned so the caller can ask which one.
export function findSeries(all: any[], title: string, year?: number): SeriesLookup {
  const wanted = normalizeTitle(title);
  if (!wanted) return null;
  const withYear = (list: any[]) => (year === undefined ? list : list.filter((s) => s.year === year));

  const exact = withYear(
    all.filter(
      (s) =>
        normalizeTitle(String(s.title ?? "")) === wanted ||
        (s.alternateTitles ?? []).some((alt: any) => normalizeTitle(String(alt.title ?? "")) === wanted)
    )
  );
  if (exact.length === 1) return { series: exact[0] };
  if (exact.length > 1) return { candidates: exact };

  const partial = withYear(all.filter((s) => normalizeTitle(String(s.title ?? "")).includes(wanted)));
  if (partial.length === 1) return { series: partial[0] };
  if (partial.length > 1) return { candidates: partial };
  return null;
}

// What Sonarr will do about a series' missing episodes, in words.
function monitoringNote(series: any, analysis: SeriesAnalysis): string {
  if (!series.monitored) return "not monitored (Sonarr will not look for missing episodes)";
  if (analysis.missingMonitored > 0) return `monitored (Sonarr is looking for ${analysis.missingMonitored} of them)`;
  return "monitored, but its missing episodes are unmonitored";
}

function toRow(series: any, analysis: SeriesAnalysis): MediaRow {
  const missingNote = analysis.missing > 0 ? `Missing ${analysis.missing} - ${series.monitored ? (analysis.missingMonitored > 0 ? "Sonarr is searching" : "monitored, episodes unmonitored") : "not monitored"}` : "Complete";
  return {
    kind: "show",
    title: String(series.title),
    year: typeof series.year === "number" && series.year > 0 ? series.year : null,
    posterUrl: null,
    libraries: null,
    genres: [],
    rating: null,
    detail: missingNote,
    show: {
      seasons: analysis.seasons.length,
      episodes: analysis.released,
      watchedEpisodes: null,
      ownedEpisodes: analysis.have,
      network: typeof series.network === "string" && series.network ? series.network : null,
    },
  };
}

export async function fetchAllSeries(): Promise<any[]> {
  const response = await sonarrClient.get("/api/v3/series");
  return (response.data ?? []) as any[];
}

export async function fetchEpisodes(seriesId: number): Promise<any[]> {
  const response = await sonarrClient.get("/api/v3/episode", { params: { seriesId } });
  return (response.data ?? []) as any[];
}

// [1, 2, 3, 5] -> "1-3, 5"
export function seasonRanges(numbers: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < numbers.length; ) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j]! + 1) j++;
    parts.push(j > i ? `${numbers[i]}-${numbers[j]}` : `${numbers[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

// The per-season breakdown for one show. Complete seasons share one line, and
// a run of consecutive seasons with nothing downloaded is one line too.
function describeSeasons(analysis: SeriesAnalysis): string[] {
  const lines: string[] = [];
  const complete = analysis.seasons.filter((s) => s.released > 0 && s.missing.length === 0);
  if (complete.length > 0) {
    lines.push(`Complete: season${complete.length === 1 ? "" : "s"} ${seasonRanges(complete.map((s) => s.season))}.`);
  }

  const incomplete = analysis.seasons.filter((s) => s.missing.length > 0);
  const groups: SeasonStatus[][] = [];
  for (const season of incomplete) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (season.have === 0 && previous && previous.have === 0 && previous.season + 1 === season.season) last!.push(season);
    else groups.push([season]);
  }
  for (const group of groups.slice(0, MAX_SEASON_LINES)) {
    const first = group[0]!;
    if (group.length > 1) {
      lines.push(`Seasons ${seasonRanges(group.map((s) => s.season))}: nothing downloaded (${group.reduce((sum, s) => sum + s.released, 0)} episodes).`);
    } else if (first.have === 0) {
      lines.push(`Season ${first.season}: none of ${first.released} episodes.`);
    } else {
      lines.push(`Season ${first.season}: ${first.have} of ${first.released} - missing ${episodeRanges(first.missing)}.`);
    }
  }
  if (groups.length > MAX_SEASON_LINES) {
    lines.push(`...and ${groups.length - MAX_SEASON_LINES} more seasons with missing episodes.`);
  }
  const notAired = analysis.seasons.filter((s) => s.unaired > 0);
  if (notAired.length > 0) {
    lines.push(`Not aired yet (not counted as missing): ${notAired.map((s) => `season ${s.season} has ${s.unaired}`).join(", ")}.`);
  }
  return lines;
}

// Finds the one show a title means, or the reply explaining why not (unknown,
// or several to choose from). Used by every single-show Sonarr tool.
export async function resolveSeries(title: string, year?: number): Promise<{ series: any } | { reply: ReturnType<typeof textReply> }> {
  const found = findSeries(await fetchAllSeries(), title, year);
  if (!found) {
    return { reply: textReply(`No series matching "${title}" in Sonarr. It may not be tracked by Sonarr.`) };
  }
  if ("candidates" in found) {
    const names = found.candidates.slice(0, 10).map(label);
    return {
      reply: textReply(
        `"${title}" matches ${found.candidates.length} series in Sonarr: ${names.join("; ")}${found.candidates.length > 10 ? "; ..." : ""}. Ask again with the full title (and year if needed).`
      ),
    };
  }
  return { series: found.series };
}

export async function checkSeriesCompleteness(title: string, year?: number) {
  if (!isConfigured("SONARR")) return textReply(NOT_CONFIGURED, true);
  try {
    const resolved = await resolveSeries(title, year);
    if ("reply" in resolved) return resolved.reply;
    const { series } = resolved;
    const analysis = analyzeEpisodes(await fetchEpisodes(series.id));
    const status = [series.status, series.monitored ? "monitored" : "not monitored"].filter(Boolean).join(", ");

    let output = `## ${label(series)} - Sonarr: ${status}\n`;
    if (analysis.released === 0) {
      output += `No episodes have aired yet${analysis.unaired > 0 ? ` (${analysis.unaired} upcoming)` : ""}.\n`;
    } else if (analysis.missing === 0) {
      output += `Complete: you have all ${analysis.released} aired episodes across ${analysis.seasons.filter((s) => s.released > 0).length} season${analysis.seasons.filter((s) => s.released > 0).length === 1 ? "" : "s"}.\n`;
    } else {
      output += `NOT complete: you have ${analysis.have} of ${analysis.released} aired episodes (${analysis.missing} missing). In Sonarr the show is ${monitoringNote(series, analysis)}.\n`;
    }
    if (analysis.released > 0) output += describeSeasons(analysis).map((line) => `- ${line}`).join("\n") + "\n";
    if (analysis.specials.total > 0) {
      output += `Specials (season 0, not counted above): ${analysis.specials.have} of ${analysis.specials.total} downloaded.\n`;
    }
    if (series.nextAiring) output += `Next episode airs ${String(series.nextAiring).slice(0, 10)}.\n`;
    output += "This is what Sonarr has downloaded; it doesn't check that Plex has scanned the files.\n";

    return { ...textReply(output), structuredContent: { media: [toRow(series, analysis)], append: false } };
  } catch (error: unknown) {
    return textReply(`Failed to check Sonarr: ${getErrorMessage(error)}`, true);
  }
}

export interface SeriesGapOptions {
  // Series-level monitoring: "monitored" = Sonarr is still watching the show;
  // "searching" = it is monitored AND has missing episodes it will look for
  // (Sonarr's own "wanted" list).
  monitored?: "any" | "monitored" | "unmonitored" | "searching";
  minMissing?: number;
  maxMissing?: number;
  // Skip shows with no downloaded episodes at all (added, but nothing grabbed).
  hideEmpty?: boolean;
  limit?: number;
}

// Runs `task` over `items` with at most `limit` in flight; the first failure
// rejects the whole thing (a ranking with silent holes would mislead).
async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    })
  );
  return results;
}

export async function findSeriesGaps(options: SeriesGapOptions = {}) {
  if (!isConfigured("SONARR")) return textReply(NOT_CONFIGURED, true);
  const { monitored = "any", hideEmpty = false } = options;
  const minMissing = Math.max(options.minMissing ?? 1, 1);
  const maxMissing = options.maxMissing;
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_GAP_LIMIT, 1), MAX_GAP_LIMIT);

  try {
    const all = await fetchAllSeries();
    // A series whose every episode already has a file cannot have a gap, so its
    // episodes need not be fetched.
    const candidates = all.filter((s) => {
      const stats = s.statistics;
      return !stats || !(stats.totalEpisodeCount <= stats.episodeFileCount);
    });
    const analysed = await mapWithLimit(candidates, EPISODE_FETCH_CONCURRENCY, async (series) => ({
      series,
      analysis: analyzeEpisodes(await fetchEpisodes(series.id)),
    }));

    const withGaps = analysed.filter(({ analysis }) => analysis.missing > 0);
    const wanted = withGaps
      .filter(({ series, analysis }) => {
        if (monitored === "any") return true;
        if (monitored === "searching") return Boolean(series.monitored) && analysis.missingMonitored > 0;
        return (monitored === "monitored") === Boolean(series.monitored);
      })
      .filter(({ analysis }) => analysis.missing >= minMissing && (maxMissing === undefined || analysis.missing <= maxMissing))
      .filter(({ analysis }) => !hideEmpty || analysis.have > 0)
      .sort((a, b) => b.analysis.missing - a.analysis.missing || String(a.series.title).localeCompare(String(b.series.title)));

    const filters = [
      monitored !== "any" ? monitored : null,
      minMissing > 1 ? `at least ${minMissing} missing` : null,
      maxMissing !== undefined ? `at most ${maxMissing} missing` : null,
      hideEmpty ? "with some episodes downloaded" : null,
    ].filter(Boolean);
    const filterText = filters.length > 0 ? ` (${filters.join(", ")})` : "";

    if (wanted.length === 0) {
      return textReply(`No Sonarr series have aired episodes missing${filterText}. ${all.length} series checked.`);
    }

    const totalMissing = wanted.reduce((sum, { analysis }) => sum + analysis.missing, 0);
    const searched = wanted.filter(({ series, analysis }) => series.monitored && analysis.missingMonitored > 0);
    const empty = wanted.filter(({ analysis }) => analysis.have === 0).length;
    const shown = wanted.slice(0, limit);

    let output = `## Series with missing episodes${filterText}\n`;
    output += `${wanted.length} of ${all.length} series have aired episodes without a file, ${totalMissing} episodes in all. `;
    output += `Sonarr is actively looking for episodes of ${searched.length} of them; ${empty} have nothing downloaded at all. `;
    output += `Missing means aired regular episodes (specials excluded). The user sees the same shows in a table below your reply.\n`;
    if (wanted.length > shown.length) {
      output += `Listed the ${shown.length} with the most missing; ${wanted.length - shown.length} more are not listed (raise limit up to ${MAX_GAP_LIMIT}, or narrow with the filters).\n`;
    }
    output += "\n";
    for (const { series, analysis } of shown) {
      output += `- ${label(series)} - ${analysis.have} of ${analysis.released} aired episodes, ${analysis.missing} missing - ${series.status ?? "unknown status"}, ${monitoringNote(series, analysis)}\n`;
    }

    return { ...textReply(output), structuredContent: { media: shown.map(({ series, analysis }) => toRow(series, analysis)), append: false } };
  } catch (error: unknown) {
    return textReply(`Failed to check Sonarr: ${getErrorMessage(error)}`, true);
  }
}
