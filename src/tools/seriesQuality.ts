import { sonarrClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";
import type { MediaRow } from "./plex.js";
import { fetchAllSeries, label, mapWithLimit, NOT_CONFIGURED } from "./series.js";

// "Which shows do I only have in 720p?" / "which shows mix qualities?", from the
// quality Sonarr recorded for each downloaded file. Sonarr's own statistics say
// nothing about quality, so every show's files are read (one call each; about 17
// seconds for a few hundred shows), and the summary is kept for a few minutes so
// follow-up questions are instant.

const FETCH_CONCURRENCY = 8;
const CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 200;

export interface QualityOptions {
  // The best quality a show has is at most / at least this many lines (480, 720, 1080, 2160).
  bestAtMost?: number;
  bestAtLeast?: number;
  // Only shows whose files are not all the same resolution.
  mixedOnly?: boolean;
  monitored?: "any" | "monitored" | "unmonitored";
  // Only shows whose Sonarr folder contains this text, e.g. "kids", "anime", "sports"
  // (Sonarr's root folders are how this setup separates kinds of shows).
  folder?: string;
  limit?: number;
}

interface QualitySummary {
  series: any;
  files: number;
  // Resolution (0 = unknown) -> number of files.
  byResolution: Map<number, number>;
  // Highest / lowest known resolution; null when none is known.
  best: number | null;
  worst: number | null;
}

let cache: { at: number; summaries: QualitySummary[] } | null = null;

// For tests: forget the cached summary.
export function resetQualityCache(): void {
  cache = null;
}

const resolutionLabel = (resolution: number) => (resolution > 0 ? `${resolution}p` : "unknown");

function summarise(series: any, files: any[]): QualitySummary {
  const byResolution = new Map<number, number>();
  for (const file of files) {
    const resolution = Number(file.quality?.quality?.resolution) || 0;
    byResolution.set(resolution, (byResolution.get(resolution) ?? 0) + 1);
  }
  const known = [...byResolution.keys()].filter((r) => r > 0);
  return {
    series,
    files: files.length,
    byResolution,
    best: known.length > 0 ? Math.max(...known) : null,
    worst: known.length > 0 ? Math.min(...known) : null,
  };
}

async function loadSummaries(now: number): Promise<QualitySummary[]> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.summaries;
  const all = await fetchAllSeries();
  // A show with no files has no quality; its files need not be fetched.
  const withFiles = all.filter((s) => !s.statistics || (s.statistics.episodeFileCount ?? 1) > 0);
  const summaries = await mapWithLimit(withFiles, FETCH_CONCURRENCY, async (series) => {
    const response = await sonarrClient.get("/api/v3/episodefile", { params: { seriesId: series.id } });
    return summarise(series, (response.data ?? []) as any[]);
  });
  cache = { at: now, summaries };
  return summaries;
}

const breakdown = (s: QualitySummary) =>
  [...s.byResolution].sort((a, b) => b[0] - a[0]).map(([resolution, n]) => `${resolutionLabel(resolution)} x${n}`).join(", ");

export async function findSeriesByQuality(options: QualityOptions = {}, now: number = Date.now()) {
  if (!isConfigured("SONARR")) return textReply(NOT_CONFIGURED, true);
  const { bestAtMost, bestAtLeast, mixedOnly = false, monitored = "any" } = options;
  const folder = options.folder?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  for (const [name, value] of [["bestAtMost", bestAtMost], ["bestAtLeast", bestAtLeast]] as const) {
    if (value !== undefined && !(value > 0)) return textReply(`${name} must be a resolution such as 480, 720, 1080 or 2160.`, true);
  }
  if (bestAtMost !== undefined && bestAtLeast !== undefined && bestAtLeast > bestAtMost) {
    return textReply("bestAtLeast is above bestAtMost, so no show can match.", true);
  }

  try {
    const summaries = await loadSummaries(now);
    const wanted = summaries
      .filter((s) => bestAtMost === undefined || (s.best !== null && s.best <= bestAtMost))
      .filter((s) => bestAtLeast === undefined || (s.best !== null && s.best >= bestAtLeast))
      .filter((s) => !mixedOnly || (s.best !== null && s.worst !== null && s.worst < s.best))
      .filter((s) => monitored === "any" || (monitored === "monitored") === Boolean(s.series.monitored))
      .filter((s) => !folder || String(s.series.path ?? "").toLowerCase().includes(folder))
      // Lowest best quality first (the likeliest upgrade candidates), bigger collections first.
      .sort((a, b) => (a.best ?? 0) - (b.best ?? 0) || b.files - a.files || String(a.series.title).localeCompare(String(b.series.title)));

    const tally = (predicate: (best: number | null) => boolean) => summaries.filter((s) => predicate(s.best)).length;
    let output = `## Show quality (from Sonarr's downloaded files)\n`;
    output += `${summaries.length} shows have files. By best quality: 2160p ${tally((b) => b !== null && b >= 2160)}, 1080p ${tally((b) => b !== null && b >= 1080 && b < 2160)}, 720p ${tally((b) => b !== null && b >= 720 && b < 1080)}, below 720p ${tally((b) => b !== null && b < 720)}, unknown ${tally((b) => b === null)}. `;
    output += `${summaries.filter((s) => s.best !== null && s.worst !== null && s.worst < s.best).length} mix resolutions. `;
    output += "This is the quality Sonarr downloaded: a 4K copy in Plex's 4K libraries that Sonarr does not manage is not seen here (use search_plex_library with library '4k'). The user sees the same shows in a table below your reply.\n";

    const filters = [
      bestAtMost !== undefined ? `best at most ${bestAtMost}p` : null,
      bestAtLeast !== undefined ? `best at least ${bestAtLeast}p` : null,
      mixedOnly ? "mixed qualities" : null,
      monitored !== "any" ? monitored : null,
      folder ? `in folders matching "${options.folder!.trim()}"` : null,
    ].filter(Boolean);
    if (filters.length > 0) output += `Matching (${filters.join(", ")}): ${wanted.length} show${wanted.length === 1 ? "" : "s"}.\n`;
    if (wanted.length === 0) return textReply(output.trimEnd());

    const shown = wanted.slice(0, limit);
    if (wanted.length > shown.length) output += `Listed the ${shown.length} with the lowest best quality (then the most files); ${wanted.length - shown.length} more are not listed (raise limit up to ${MAX_LIMIT}, or narrow the filters).\n`;
    output += "\n";
    for (const s of shown) output += `- ${label(s.series)} - best ${s.best !== null ? `${s.best}p` : "unknown"}: ${breakdown(s)} - ${s.series.monitored ? "monitored" : "not monitored"}\n`;

    const media: MediaRow[] = shown.map((s) => ({
      kind: "show",
      title: String(s.series.title),
      year: typeof s.series.year === "number" && s.series.year > 0 ? s.series.year : null,
      posterUrl: null,
      libraries: null,
      genres: [],
      rating: null,
      detail: `best ${s.best !== null ? `${s.best}p` : "unknown"}: ${breakdown(s)}`,
    }));
    return { ...textReply(output), structuredContent: { media, append: false } };
  } catch (error: unknown) {
    return textReply(`Failed to check Sonarr: ${getErrorMessage(error)}`, true);
  }
}
