import { sonarrClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";
import type { MediaRow } from "./plex.js";
import { analyzeEpisodes, fetchEpisodes, label, NOT_CONFIGURED, resolveSeries, type SeriesAnalysis } from "./series.js";

// The TV counterparts of check_movie_status and diagnose_missing_media: what
// Sonarr knows about one show, and why an episode it should have is missing.
//
// SECURITY: Sonarr's history records carry a `data` object that includes the
// release's download URL, and that URL contains the indexer's API key. Nothing
// from `data` is passed through; only the few named fields read below are used.

const MAX_GROUPS = 6;
const MAX_EXAMPLES = 4;
const RELEVANT_EVENTS = new Set(["grabbed", "downloadFailed", "downloadIgnored", "downloadFolderImported", "episodeFileDeleted"]);

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const day = (iso: unknown) => (typeof iso === "string" && iso ? iso.slice(0, 10) : "an unknown date");
const code = (season: number, episode: number) => `S${season}E${String(episode).padStart(2, "0")}`;

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1e6))} MB`;
}

// --- What Sonarr's download queue says -------------------------------------

export function describeQueueItem(item: any): string {
  const state = String(item.trackedDownloadState ?? "");
  const size = Number(item.size);
  const left = Number(item.sizeleft);
  const percent = size > 0 && Number.isFinite(left) ? Math.max(0, Math.min(100, Math.round(((size - left) / size) * 100))) : null;
  const message = String(item.errorMessage || item.statusMessages?.[0]?.messages?.[0] || item.statusMessages?.[0]?.title || "").trim();

  switch (state) {
    case "downloading":
      if (item.status === "paused") return `paused${percent !== null ? ` at ${percent}%` : ""}`;
      return `downloading${percent !== null ? ` ${percent}%` : ""}${item.timeleft ? `, about ${item.timeleft} left` : ""}`;
    case "importPending":
    case "importing":
      return "downloaded, waiting to be imported";
    case "importBlocked":
      return `downloaded but the import is blocked${message ? `: ${truncate(message, 140)}` : ""}`;
    case "failedPending":
    case "failed":
      return `the download failed${message ? `: ${truncate(message, 140)}` : ""}`;
    case "ignored":
      return "ignored";
    default:
      return String(item.status || "in the queue");
  }
}

// --- What happened to an episode before ------------------------------------

export type Story =
  | { kind: "queued"; note: string }
  | { kind: "deleted"; date: string; reason: string | null }
  | { kind: "failed"; date: string; message: string | null; release: string | null }
  | { kind: "grabbed"; date: string; release: string | null; indexer: string | null }
  | { kind: "ignored"; date: string; message: string | null }
  | { kind: "imported"; date: string }
  | { kind: "never" };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

// The most recent thing that happened to one episode, from its history records
// (newest first is not assumed) or, above all, its place in the download queue.
export function storyOf(records: any[], queueItem?: any): Story {
  if (queueItem) return { kind: "queued", note: describeQueueItem(queueItem) };

  const latest = records
    .filter((r) => RELEVANT_EVENTS.has(r.eventType))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!latest) return { kind: "never" };

  const date = day(latest.date);
  const data = latest.data ?? {};
  switch (latest.eventType) {
    case "episodeFileDeleted":
      return { kind: "deleted", date, reason: text(data.reason) };
    case "downloadFailed":
      return { kind: "failed", date, message: text(data.message), release: text(latest.sourceTitle) };
    case "grabbed":
      return { kind: "grabbed", date, release: text(latest.sourceTitle), indexer: text(data.indexer) };
    case "downloadIgnored":
      return { kind: "ignored", date, message: text(data.message) };
    default:
      return { kind: "imported", date };
  }
}

const HEADLINE: Record<Story["kind"], string> = {
  queued: "in the download queue",
  deleted: "the file was removed",
  failed: "the last download attempt failed",
  grabbed: "a release was grabbed but never imported",
  ignored: "the release that was found was ignored",
  imported: "it was imported once, but the file is gone",
  never: "never downloaded (nothing has ever been grabbed)",
};

function exampleDetail(story: Story): string {
  switch (story.kind) {
    case "queued":
      return story.note;
    case "deleted":
      return `removed ${story.date}${story.reason ? `: ${story.reason}` : ""}`;
    case "failed":
      return `failed ${story.date}${story.message ? `: ${truncate(story.message, 100)}` : ""}`;
    case "grabbed":
      return `grabbed ${story.date}${story.release ? `: ${truncate(story.release, 80)}` : ""}`;
    case "ignored":
      return `ignored ${story.date}${story.message ? `: ${truncate(story.message, 80)}` : ""}`;
    case "imported":
      return `imported ${story.date}`;
    default:
      return "";
  }
}

// --- diagnose_missing_episodes ---------------------------------------------

export interface DiagnoseOptions {
  season?: number;
  episode?: number;
  year?: number;
}

interface Diagnosed {
  episode: any;
  story: Story;
  // Would Sonarr go looking for it? (show monitored AND episode monitored)
  searching: boolean;
}

const queueFor = async (seriesId: number): Promise<any[]> => {
  const response = await sonarrClient.get("/api/v3/queue", { params: { page: 1, pageSize: 500 } });
  return ((response.data?.records ?? []) as any[]).filter((item) => item.seriesId === seriesId);
};

const historyFor = async (seriesId: number, season?: number): Promise<any[]> => {
  const params: Record<string, unknown> = { seriesId };
  if (season !== undefined) params.seasonNumber = season;
  const response = await sonarrClient.get("/api/v3/history/series", { params });
  return Array.isArray(response.data) ? response.data : [];
};

function consequence(series: any, group: Diagnosed[]): string {
  const first = group[0]!;
  if (first.story.kind === "queued") return "Sonarr is already handling it.";
  if (!first.searching) {
    const why = !series.monitored ? "the show is not monitored" : "these episodes are not monitored";
    return `Sonarr will not look for ${group.length === 1 ? "it" : "them"} because ${why}; turn monitoring on in Sonarr to have ${group.length === 1 ? "it" : "them"} searched.`;
  }
  if (first.story.kind === "never") {
    const searched = group.map((d) => text(d.episode.lastSearchTime)).filter((t): t is string => t !== null).sort().pop();
    return searched
      ? `Sonarr is monitoring ${group.length === 1 ? "it" : "them"} and last searched on ${day(searched)} without finding a usable release; check the indexers and the quality profile.`
      : `Sonarr is monitoring ${group.length === 1 ? "it" : "them"} but has never searched for ${group.length === 1 ? "it" : "them"}; it only finds older episodes when a release turns up in an RSS sync, so running a search for missing episodes in Sonarr would look now.`;
  }
  return `Sonarr is monitoring ${group.length === 1 ? "it" : "them"}, so it will search again.`;
}

export async function diagnoseMissingEpisodes(title: string, options: DiagnoseOptions = {}) {
  if (!isConfigured("SONARR")) return textReply(NOT_CONFIGURED, true);
  const { season, episode: episodeNumber, year } = options;
  if (episodeNumber !== undefined && season === undefined) {
    return textReply("To diagnose one episode, give its season number as well.", true);
  }

  try {
    const resolved = await resolveSeries(title, year);
    if ("reply" in resolved) return resolved.reply;
    const { series } = resolved;

    const [episodes, queue, history] = await Promise.all([fetchEpisodes(series.id), queueFor(series.id), historyFor(series.id, season)]);
    const analysis = analyzeEpisodes(episodes);
    const now = Date.now();
    const released = (e: any) => e.hasFile || (e.airDateUtc && Date.parse(e.airDateUtc) <= now);
    const heading = `## ${label(series)} - ${series.monitored ? "monitored" : "not monitored"} in Sonarr\n`;

    // Which episodes to look at.
    let targets: any[];
    if (season !== undefined && !episodes.some((e) => e.seasonNumber === season)) {
      return textReply(`${heading}${label(series)} has no season ${season} in Sonarr.`);
    }
    if (episodeNumber !== undefined) {
      const one = episodes.find((e) => e.seasonNumber === season && e.episodeNumber === episodeNumber);
      if (!one) return textReply(`${heading}Sonarr has no ${code(season!, episodeNumber)} for ${label(series)}.`);
      const name = `${code(season!, episodeNumber)}${one.title ? ` "${one.title}"` : ""}`;
      if (one.hasFile) return textReply(`${heading}${name} is not missing: Sonarr has a file for it.`);
      if (!released(one)) return textReply(`${heading}${name} has not aired yet${one.airDateUtc ? ` (it airs ${day(one.airDateUtc)})` : ""}, so it is not missing.`);
      targets = [one];
    } else {
      targets = episodes.filter((e) => e.seasonNumber > 0 && !e.hasFile && released(e) && (season === undefined || e.seasonNumber === season));
    }

    if (targets.length === 0) {
      return textReply(`${heading}Nothing is missing${season !== undefined ? ` from season ${season}` : ""}: every aired episode has a file.`);
    }

    // What happened to each one. History and queue were each fetched once.
    const byEpisode = new Map<number, any[]>();
    for (const record of history) {
      const list = byEpisode.get(record.episodeId) ?? [];
      list.push(record);
      byEpisode.set(record.episodeId, list);
    }
    const queued = new Map<number, any>(queue.map((item) => [item.episodeId, item]));
    const diagnosed: Diagnosed[] = targets.map((episode) => ({
      episode,
      story: storyOf(byEpisode.get(episode.id) ?? [], queued.get(episode.id)),
      searching: Boolean(series.monitored && episode.monitored),
    }));

    // One line per (what happened, would Sonarr search) pair, biggest first.
    const groups = new Map<string, Diagnosed[]>();
    for (const item of diagnosed) {
      const key = `${item.story.kind}|${item.searching}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const ordered = [...groups.values()].sort((a, b) => b.length - a.length);

    let output = heading;
    output += `${targets.length} aired episode${targets.length === 1 ? " has" : "s have"} no file${season !== undefined ? ` in season ${season}` : ""}. `;
    output += `Why, from Sonarr's history and download queue (nothing was changed):\n`;
    for (const group of ordered.slice(0, MAX_GROUPS)) {
      const examples = group
        .slice(0, MAX_EXAMPLES)
        .map(({ episode, story }) => {
          const detail = exampleDetail(story);
          return `${code(episode.seasonNumber, episode.episodeNumber)}${episode.title ? ` "${episode.title}"` : ""}${detail ? ` (${detail})` : ""}`;
        })
        .join("; ");
      const more = group.length > MAX_EXAMPLES ? `; and ${group.length - MAX_EXAMPLES} more` : "";
      output += `- ${group.length} episode${group.length === 1 ? "" : "s"}: ${HEADLINE[group[0]!.story.kind]}. ${consequence(series, group)} ${examples}${more}.\n`;
    }
    if (ordered.length > MAX_GROUPS) {
      const rest = ordered.slice(MAX_GROUPS).reduce((sum, g) => sum + g.length, 0);
      output += `- ${rest} more episodes across ${ordered.length - MAX_GROUPS} other situations.\n`;
    }

    const top = ordered[0]!;
    const row: MediaRow = {
      kind: "show",
      title: String(series.title),
      year: typeof series.year === "number" && series.year > 0 ? series.year : null,
      posterUrl: null,
      libraries: null,
      genres: [],
      rating: null,
      detail: `${targets.length} missing: ${HEADLINE[top[0]!.story.kind]}${top.every((d) => d.searching) ? "" : ", not monitored"}`,
      show: {
        seasons: analysis.seasons.length,
        episodes: analysis.released,
        watchedEpisodes: null,
        ownedEpisodes: analysis.have,
        network: text(series.network),
      },
    };
    return { ...textReply(output), structuredContent: { media: [row], append: false } };
  } catch (error: unknown) {
    return textReply(`Failed to check Sonarr: ${getErrorMessage(error)}`, true);
  }
}

// --- check_series_status ---------------------------------------------------

function posterOf(series: any): string | null {
  const url = (series.images ?? []).find((image: any) => image.coverType === "poster")?.remoteUrl;
  // Only a public artwork URL: Sonarr's own /MediaCover paths need its API key.
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

export async function checkSeriesStatus(title: string, year?: number) {
  if (!isConfigured("SONARR")) return textReply(NOT_CONFIGURED, true);
  try {
    const resolved = await resolveSeries(title, year);
    if ("reply" in resolved) return resolved.reply;
    const { series } = resolved;

    const [episodes, files, profiles, queue] = await Promise.all([
      fetchEpisodes(series.id),
      sonarrClient.get("/api/v3/episodefile", { params: { seriesId: series.id } }).then((r) => (r.data ?? []) as any[]),
      sonarrClient.get("/api/v3/qualityprofile").then((r) => (r.data ?? []) as any[]),
      queueFor(series.id),
    ]);
    const analysis: SeriesAnalysis = analyzeEpisodes(episodes);
    const profile = profiles.find((p) => p.id === series.qualityProfileId)?.name ?? `profile #${series.qualityProfileId}`;
    const stats = series.statistics ?? {};

    let output = `## ${label(series)} - Sonarr: ${[series.status, series.monitored ? "monitored" : "not monitored"].filter(Boolean).join(", ")}\n`;
    const facts = [
      text(series.network) && `Network: ${series.network}`,
      text(series.seriesType) && `Type: ${series.seriesType}`,
      text(series.certification) && `Rated: ${series.certification}`,
      series.runtime ? `Runtime: ${series.runtime} min` : null,
    ].filter(Boolean);
    if (facts.length > 0) output += `${facts.join(" | ")}\n`;
    output += `Quality profile: ${profile}\n`;
    if (series.path) output += `Location: ${series.path}\n`;

    if (analysis.released === 0) {
      output += `Episodes: none have aired yet${analysis.unaired > 0 ? ` (${analysis.unaired} upcoming)` : ""}.\n`;
    } else if (analysis.missing === 0) {
      output += `Episodes: all ${analysis.released} aired episodes downloaded`;
    } else {
      output += `Episodes: ${analysis.have} of ${analysis.released} aired episodes downloaded (${analysis.missing} missing; use check_series_completeness for which)`;
    }
    if (analysis.released > 0) {
      output += `, across ${analysis.seasons.filter((s) => s.released > 0).length} season${analysis.seasons.filter((s) => s.released > 0).length === 1 ? "" : "s"}`;
      if (typeof stats.sizeOnDisk === "number" && stats.sizeOnDisk > 0) output += `, ${formatSize(stats.sizeOnDisk)} on disk`;
      output += ".\n";
    }
    if (text(series.monitorNewItems)) {
      output += `New seasons: ${series.monitorNewItems === "all" ? "monitored automatically" : series.monitorNewItems === "none" ? "not monitored automatically" : series.monitorNewItems}.\n`;
    }

    const aired = [text(series.firstAired) && `first aired ${day(series.firstAired)}`, text(series.lastAired) && `latest ${day(series.lastAired)}`].filter(Boolean);
    if (aired.length > 0) output += `Aired: ${aired.join(", ")}. `;
    output += series.nextAiring ? `Next episode airs ${day(series.nextAiring)}.\n` : "No upcoming episode is scheduled.\n";

    const newest = [...files].sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded))[0];
    if (newest) {
      const episode = episodes.find((e) => e.episodeFileId === newest.id);
      const quality = text(newest.quality?.quality?.name);
      const group = text(newest.releaseGroup);
      output += `Last download: ${day(newest.dateAdded)}${episode ? `, ${code(episode.seasonNumber, episode.episodeNumber)}` : ""}${quality || group ? ` (${[quality, group].filter(Boolean).join(", ")})` : ""}.\n`;
    } else {
      output += "Last download: nothing has been downloaded for this show.\n";
    }

    if (queue.length > 0) {
      output += `In the download queue now: ${queue.length} item${queue.length === 1 ? "" : "s"}.\n`;
      for (const item of queue.slice(0, 5)) output += `- ${describeQueueItem(item)}\n`;
    }

    const row: MediaRow = {
      kind: "show",
      title: String(series.title),
      year: typeof series.year === "number" && series.year > 0 ? series.year : null,
      posterUrl: posterOf(series),
      libraries: null,
      genres: Array.isArray(series.genres) ? series.genres.map(String) : [],
      rating: typeof series.ratings?.value === "number" && series.ratings.value > 0 ? series.ratings.value : null,
      detail: analysis.missing > 0 ? `${analysis.missing} episodes missing` : "Complete",
      show: {
        seasons: analysis.seasons.length,
        episodes: analysis.released,
        watchedEpisodes: null,
        ownedEpisodes: analysis.have,
        network: text(series.network),
      },
    };
    return { ...textReply(output), structuredContent: { media: [row], append: false } };
  } catch (error: unknown) {
    return textReply(`Failed to check Sonarr: ${getErrorMessage(error)}`, true);
  }
}
