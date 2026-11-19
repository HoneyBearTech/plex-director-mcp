import { plexClient, tautulliClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";
import {
  getSections,
  identityKeys,
  isoDay,
  lastActivity,
  mergeWatch,
  watchOf,
  type MediaRow,
  type PlexSection,
  type Watch,
} from "./plex.js";
import { fetchAllSeries, label, NOT_CONFIGURED } from "./series.js";
import { formatSize } from "./seriesDiagnosis.js";
import { indexSonarrSeries, matchShowToSonarr } from "./showMatch.js";
import type { PlexContainer, PlexMetadata } from "../types/plex.js";
import type { SonarrSeries } from "../types/sonarr.js";
import type {
  TautulliLibraryMediaInfo,
  TautulliMediaInfoRow,
  TautulliResponse,
} from "../types/tautulli.js";

// "Which shows take the most disk space?" and "which big shows has nobody
// watched in years?". The sizes come from Sonarr's own statistics (one request).
// The second question also needs watch history, which Sonarr doesn't have: it
// is read from Plex (the account the app is connected with) and, when Tautulli
// is configured, from Tautulli's play history as well.
//
// It is a report. Nothing here changes or deletes anything: every request is a GET.
//
// Tautulli can only take a show off the "not watched" list, never put one on
// it. The candidates are decided from Plex alone; a Tautulli row with plays
// then makes a candidate watched, which removes it or corrects its date. A row
// with no plays, a missing row and an unusable answer all mean "Tautulli adds
// nothing", never "nobody watched it": its history starts when it was
// installed and its list of shows can lag behind Plex.

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 200;
const DAY_MS = 86_400_000;
const GB = 1e9;
// Plex and Tautulli are each asked for a whole library in one go; libraries
// here are well under this.
const FETCH_ALL = 5000;
// Tautulli builds this list from its own cache and can be slow on a big
// library, so this one call may take longer than the clients' usual 10 seconds.
const TAUTULLI_MEDIA_INFO_TIMEOUT_MS = 30_000;

export type SeriesSizeStatus = "continuing" | "ended" | "upcoming";

export interface SeriesSizeOptions {
  // Only shows with no watching in this many years (a never-watched show
  // counts from when it was added to Plex). Needs Plex.
  notWatchedInYears?: number;
  // The show's status in Sonarr.
  status?: SeriesSizeStatus;
  monitored?: "any" | "monitored" | "unmonitored";
  // Only shows whose Sonarr folder contains this text, e.g. "kids", "anime".
  folder?: string;
  // Only shows of at least this size. A GB is 10^9 bytes, as the sizes are printed.
  minSizeGb?: number;
  limit?: number;
}

const sizeOf = (series: SonarrSeries) => Number(series.statistics?.sizeOnDisk) || 0;
const filesOf = (series: SonarrSeries) => Number(series.statistics?.episodeFileCount) || 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const latest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

// One show as Plex holds it: every library copy, and what the connected
// account has watched of it over all of them.
interface PlexShow {
  copies: { item: PlexMetadata; section: PlexSection }[];
  watch: Watch;
}

// A show that Plex alone says has not been watched for long enough.
interface Candidate {
  series: SonarrSeries;
  plex: PlexShow;
  // Epoch seconds of the last watching, or null when it was never watched.
  lastWatched: number | null;
  // Set when Tautulli is configured but added nothing for this show.
  plexOnly: "noRowOrNoPlays" | "libraryUnusable" | null;
}

type LibraryAnswer =
  | { usable: true; rows: Map<string, TautulliMediaInfoRow> }
  | { usable: false; why: string };

// Every show in every Plex show library, the ones left out of searches by the
// "libraries to skip" setting included: a clean-up report is about all of them.
async function readPlexShows(): Promise<{
  sections: PlexSection[];
  shows: PlexShow[];
  // Section key -> how many shows Plex listed in that library.
  counts: Map<string, number>;
}> {
  const sections = await getSections(["show"]);
  const perSection = await Promise.all(
    sections.map(async (section) => {
      const response = await plexClient.get<PlexContainer>(`/library/sections/${section.key}/all`, {
        params: {
          includeGuids: 1,
          "X-Plex-Container-Start": 0,
          "X-Plex-Container-Size": FETCH_ALL,
        },
      });
      return { section, items: response.data?.MediaContainer?.Metadata ?? [] };
    }),
  );
  // One entry per show, however many libraries hold it (as search_plex_library groups them).
  const byKey = new Map<string, PlexShow>();
  const shows: PlexShow[] = [];
  for (const { section, items } of perSection) {
    for (const item of items) {
      const keys = identityKeys(item, "show");
      const existing = keys.map((k) => byKey.get(k)).find((s) => s !== undefined);
      if (existing) {
        existing.copies.push({ item, section });
        existing.watch = mergeWatch(existing.watch, watchOf(item, "show"));
        for (const k of keys) byKey.set(k, existing);
      } else {
        const show: PlexShow = { copies: [{ item, section }], watch: watchOf(item, "show") };
        shows.push(show);
        for (const k of keys) byKey.set(k, show);
      }
    }
  }
  const counts = new Map(perSection.map(({ section, items }) => [section.key, items.length]));
  return { sections, shows, counts };
}

// Tautulli's list of one library, by Plex rating key, asked for in one page
// long enough for the whole library. It is never asked to refresh (rebuild)
// the list. The answer is used only if the call worked, Tautulli says
// "success", and it holds every row it says the library has.
async function readTautulliLibrary(
  section: PlexSection,
  showsInPlex: number,
): Promise<LibraryAnswer> {
  let payload: TautulliResponse<TautulliLibraryMediaInfo>["response"];
  try {
    const response = await tautulliClient.get<TautulliResponse<TautulliLibraryMediaInfo>>("", {
      params: {
        cmd: "get_library_media_info",
        section_id: section.key,
        length: Math.max(FETCH_ALL, showsInPlex),
      },
      timeout: TAUTULLI_MEDIA_INFO_TIMEOUT_MS,
    });
    payload = response.data?.response;
  } catch (error: unknown) {
    return { usable: false, why: `the call failed (${getErrorMessage(error)})` };
  }
  if (payload?.result !== "success") {
    return { usable: false, why: "the call failed (Tautulli did not answer with success)" };
  }
  const rows = payload.data?.data;
  const total = Number(payload.data?.recordsTotal);
  if (!Array.isArray(rows) || !Number.isFinite(total)) {
    return { usable: false, why: "the answer was incomplete (it held no list of shows)" };
  }
  if (rows.length < total) {
    return {
      usable: false,
      why: `the answer was incomplete (${rows.length} of ${total} rows)`,
    };
  }
  const byKey = new Map<string, TautulliMediaInfoRow>();
  for (const row of rows) {
    if (row && row.rating_key !== undefined && row.rating_key !== null)
      byKey.set(String(row.rating_key), row);
  }
  return { usable: true, rows: byKey };
}

export async function findSeriesBySize(options: SeriesSizeOptions = {}, now: number = Date.now()) {
  if (!isConfigured("SONARR")) return textReply(NOT_CONFIGURED, true);
  const { notWatchedInYears, status, monitored = "any", minSizeGb } = options;
  const folder = options.folder?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  if (notWatchedInYears !== undefined && !(notWatchedInYears > 0))
    return textReply("notWatchedInYears must be greater than 0.", true);
  if (minSizeGb !== undefined && !(minSizeGb > 0))
    return textReply("minSizeGb must be greater than 0.", true);
  const watchPart = notWatchedInYears !== undefined;
  if (watchPart && !isConfigured("PLEX")) {
    return textReply(
      'The "not watched" part needs Plex, which isn\'t configured: watch history comes from Plex (and Tautulli when it is set up), not from Sonarr. Set the Plex URL and token on the Settings page (or PLEX_URL / PLEX_TOKEN in .env), or leave out notWatchedInYears to rank shows by size alone.',
      true,
    );
  }

  let all: SonarrSeries[];
  try {
    all = await fetchAllSeries();
  } catch (error: unknown) {
    return textReply(`Failed to check Sonarr: ${getErrorMessage(error)}`, true);
  }

  const withFiles = all.filter((s) => filesOf(s) > 0 || sizeOf(s) > 0);
  const totalSize = (list: SonarrSeries[]) => list.reduce((sum, s) => sum + sizeOf(s), 0);
  const matching = withFiles
    .filter((s) => !status || s.status === status)
    .filter((s) => monitored === "any" || (monitored === "monitored") === Boolean(s.monitored))
    .filter(
      (s) =>
        !folder ||
        String(s.path ?? "")
          .toLowerCase()
          .includes(folder),
    )
    .filter((s) => minSizeGb === undefined || sizeOf(s) >= minSizeGb * GB)
    // Largest first, then by title so equal sizes come out in a fixed order.
    .sort((a, b) => sizeOf(b) - sizeOf(a) || String(a.title).localeCompare(String(b.title)));

  const filters = [
    status ?? null,
    monitored !== "any" ? (monitored === "monitored" ? "monitored" : "not monitored") : null,
    folder ? `in folders matching "${options.folder?.trim()}"` : null,
    minSizeGb !== undefined ? `at least ${minSizeGb} GB` : null,
  ].filter(Boolean);

  let output = watchPart
    ? `## Big shows not watched in ${notWatchedInYears} year${notWatchedInYears === 1 ? "" : "s"} (sizes from Sonarr)\n`
    : "## Biggest shows (sizes from Sonarr)\n";
  output += `${plural(withFiles.length, "show has", "shows have")} files, ${formatSize(totalSize(withFiles))} in all. `;
  if (filters.length > 0)
    output += `Matching (${filters.join(", ")}): ${plural(matching.length, "show")}, ${formatSize(totalSize(matching))}. `;
  output +=
    "This is a report: nothing is changed or deleted. The user sees the same shows in a table below your reply.\n";

  const sizeLine = (s: SonarrSeries) =>
    `${formatSize(sizeOf(s))} - ${plural(filesOf(s), "episode file")} - ${s.status ?? "status unknown"} - ${s.monitored ? "monitored" : "not monitored"}`;
  const baseRow = (s: SonarrSeries, detail: string): MediaRow => ({
    kind: "show",
    title: String(s.title),
    year: typeof s.year === "number" && s.year > 0 ? s.year : null,
    posterUrl: null,
    libraries: null,
    genres: [],
    rating: null,
    detail,
  });

  if (!watchPart) {
    if (matching.length === 0) return textReply(output.trimEnd());
    const shown = matching.slice(0, limit);
    if (matching.length > shown.length)
      output += `Listed the ${shown.length} largest; ${matching.length - shown.length} more are not listed (raise limit up to ${MAX_LIMIT}, or narrow the filters).\n`;
    output += "\n";
    for (const s of shown) output += `- ${label(s)} - ${sizeLine(s)}\n`;
    const media = shown.map((s) => baseRow(s, sizeLine(s)));
    return { ...textReply(output), structuredContent: { media, append: false } };
  }

  // --- The watch part: Plex first -------------------------------------------
  let sections: PlexSection[];
  let plexShows: PlexShow[];
  let plexCounts: Map<string, number>;
  try {
    ({ sections, shows: plexShows, counts: plexCounts } = await readPlexShows());
  } catch (error: unknown) {
    return textReply(
      `Plex could not be read, so what has been watched can't be checked: ${getErrorMessage(error)}. This is a failure to reach Plex, not a result of "no shows".`,
      true,
    );
  }
  if (sections.length === 0) {
    return textReply(
      "No show libraries found in Plex, so what has been watched can't be checked.",
      true,
    );
  }

  // Which Plex show is which Sonarr series (by TVDB id, else title and year).
  const index = indexSonarrSeries(all);
  const bySeriesId = new Map<number, PlexShow>();
  for (const show of plexShows) {
    const series = matchShowToSonarr(
      show.copies.map((c) => c.item),
      index,
    );
    if (!series) continue;
    const existing = bySeriesId.get(series.id);
    if (existing) {
      existing.copies.push(...show.copies);
      existing.watch = mergeWatch(existing.watch, show.watch);
    } else {
      bySeriesId.set(series.id, { copies: [...show.copies], watch: show.watch });
    }
  }

  const cutoff = now - notWatchedInYears * 365.25 * DAY_MS;
  let notInPlex = 0;
  let cannotJudge = 0;
  let candidates: Candidate[] = [];
  for (const series of matching) {
    const plex = bySeriesId.get(series.id);
    if (!plex) {
      notInPlex++;
      continue;
    }
    // The latest watching over its copies; never watched counts from when it
    // was first added; watched with no date anywhere can't be judged.
    const activity = lastActivity("show", plex.watch);
    if (activity === null) {
      cannotJudge++;
      continue;
    }
    if (activity * 1000 < cutoff)
      candidates.push({ series, plex, lastWatched: plex.watch.lastViewed, plexOnly: null });
  }

  // --- Then Tautulli, for the candidates only ---------------------------------
  const withTautulli = isConfigured("TAUTULLI");
  const unusable: { title: string; why: string }[] = [];
  let removedByTautulli = 0;
  if (withTautulli && candidates.length > 0) {
    // Once per show library that holds a candidate.
    const wanted = sections.filter((section) =>
      candidates.some((c) => c.plex.copies.some((copy) => copy.section.key === section.key)),
    );
    const answers = new Map<string, LibraryAnswer>();
    await Promise.all(
      wanted.map(async (section) => {
        answers.set(
          section.key,
          await readTautulliLibrary(section, plexCounts.get(section.key) ?? 0),
        );
      }),
    );
    for (const section of wanted) {
      const answer = answers.get(section.key);
      if (answer && !answer.usable) unusable.push({ title: section.title, why: answer.why });
    }

    candidates = candidates.filter((candidate) => {
      let anyUsable = false;
      let played = false;
      let lastPlayed: number | null = null;
      for (const copy of candidate.plex.copies) {
        const answer = answers.get(copy.section.key);
        if (!answer?.usable) continue;
        anyUsable = true;
        const row = answer.rows.get(String(copy.item.ratingKey));
        if (!row || !(Number(row.play_count) > 0)) continue;
        played = true;
        const at = Number(row.last_played);
        if (Number.isFinite(at) && at > 0) lastPlayed = latest(lastPlayed, at);
      }
      if (!played) {
        // No plays, no row, or no usable answer: Tautulli adds nothing.
        candidate.plexOnly = anyUsable ? "noRowOrNoPlays" : "libraryUnusable";
        return true;
      }
      const watchedAt = latest(candidate.lastWatched, lastPlayed);
      if (watchedAt === null) {
        // Played according to Tautulli, but no date anywhere.
        cannotJudge++;
        return false;
      }
      if (watchedAt * 1000 >= cutoff) {
        removedByTautulli++;
        return false;
      }
      candidate.lastWatched = watchedAt;
      return true;
    });
  }

  // --- The reply ---------------------------------------------------------------
  output += withTautulli
    ? "Watch data: the Plex account the app is connected with, plus the plays in Tautulli's history. That history starts when Tautulli was installed and may leave out users archived there, so a show someone else watched can still be listed. "
    : "Watch data: only the one Plex account the app is connected with, so a show someone else watched can still be listed (Tautulli is not set up). ";
  output += `Not watched in ${notWatchedInYears} year${notWatchedInYears === 1 ? "" : "s"}: ${plural(candidates.length, "show")}, ${formatSize(totalSize(candidates.map((c) => c.series)))}.`;
  if (notInPlex > 0)
    output += ` ${plural(notInPlex, "show")} Sonarr has ${notInPlex === 1 ? "was" : "were"} not found in Plex and left out.`;
  if (cannotJudge > 0)
    output += ` ${plural(cannotJudge, "show has", "shows have")} been watched but with no date recorded, so ${cannotJudge === 1 ? "it was" : "they were"} left out because that can't be judged.`;
  if (removedByTautulli > 0)
    output += ` Tautulli's history took ${plural(removedByTautulli, "show")} off the list (played more recently there).`;
  for (const { title, why } of unusable)
    output += ` Tautulli's answer for the library "${title}" could not be used: ${why}; shows there were judged from the Plex account alone (marked "Plex account only").`;
  output += "\n";
  if (candidates.length === 0) return textReply(output.trimEnd());

  const shown = candidates.slice(0, limit);
  if (candidates.length > shown.length)
    output += `Listed the ${shown.length} largest; ${candidates.length - shown.length} more are not listed (raise limit up to ${MAX_LIMIT}, or narrow the filters).\n`;
  const plexOnlyListed = shown.filter((c) => c.plexOnly === "noRowOrNoPlays").length;
  if (plexOnlyListed > 0)
    output += `${plural(plexOnlyListed, "listed show was", "listed shows were")} judged from the Plex account alone because Tautulli had no row or no plays for ${plexOnlyListed === 1 ? "it" : "them"} (marked "Plex account only").\n`;
  output += "\n";

  const watchLine = (c: Candidate) => {
    const dated =
      c.lastWatched !== null
        ? `last watched ${isoDay(c.lastWatched)}`
        : `never watched, added ${isoDay(c.plex.watch.addedFirst)}`;
    return `${sizeLine(c.series)} - ${dated}${c.plexOnly ? " (Plex account only)" : ""}`;
  };
  for (const c of shown) output += `- ${label(c.series)} - ${watchLine(c)}\n`;
  const media = shown.map((c) => {
    const row = baseRow(c.series, watchLine(c));
    row.libraries = [...new Set(c.plex.copies.map((copy) => copy.section.title))];
    row.lastWatched = isoDay(c.lastWatched);
    row.added = isoDay(c.plex.watch.addedFirst);
    return row;
  });
  return { ...textReply(output), structuredContent: { media, append: false } };
}
