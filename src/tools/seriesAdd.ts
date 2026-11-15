import { randomUUID } from "node:crypto";
import { isAxiosError } from "axios";
import { z } from "zod";
import { server } from "../server.js";
import { db, type SeriesSelectionRow } from "../db.js";
import { sonarrClient } from "../clients.js";
import { getSetting, isConfigured } from "../settings.js";
import { textReply, getErrorMessage, escapeTableCell } from "../util.js";
import { chooseQualityProfile, radarrErrorMessage } from "./discovery.js";
import { NOT_CONFIGURED } from "./series.js";
import type { SonarrQualityProfile, SonarrRootFolder, SonarrSeries } from "../types/sonarr.js";

// Adding TV series to Sonarr, for MCP clients only (the dashboard's chat stays
// read-only). Written for Sonarr v4 (its v3 API).
//
// Adding a show can start a large download, so it takes three calls, and the
// last one is held to what the user was shown:
//   1. search_and_select_series: a numbered grid of Sonarr's lookup results.
//   2. confirm_selected_series with the numbers: a preview. It changes nothing
//      (GET requests only), says exactly what would be added with which
//      settings, and returns a preview id.
//   3. confirm_selected_series with that id alone: the add. It goes through
//      only if that id is the current preview, which is used up in the same
//      step, and only if resolving everything again gives what the preview
//      showed. Otherwise nothing is added and a new preview says what differs.
//
// The series grid and the preview have their own tables: the movie grid
// (interaction_context) and this one never touch each other.

const GRID_SIZE = 5;
const OVERVIEW_LENGTH = 180;
// A title or network from Sonarr's lookup is cut to this many characters
// where it is stored and shown (grid, preview, report).
const TEXT_LENGTH = 200;
// How long a preview can be confirmed after it was made.
const PREVIEW_LIFE_MINUTES = 15;
const PREVIEW_LIFE_MS = PREVIEW_LIFE_MINUTES * 60 * 1000;

export const SERIES_TYPES = ["standard", "daily", "anime"] as const;
export type SeriesType = (typeof SERIES_TYPES)[number];

// The values of Sonarr's MonitorTypes this tool offers (its API schema lists
// more, such as latestSeason and recent).
export const MONITOR_OPTIONS = [
  "all",
  "future",
  "missing",
  "existing",
  "firstSeason",
  "lastSeason",
  "pilot",
  "none",
] as const;
export type MonitorOption = (typeof MONITOR_OPTIONS)[number];

const MONITOR_WORDS: Record<MonitorOption, string> = {
  all: "all episodes",
  future: "future episodes",
  missing: "missing episodes",
  existing: "existing episodes",
  firstSeason: "the first season",
  lastSeason: "the last season",
  pilot: "the pilot episode",
  none: "no episodes",
};

// Never show the Sonarr API key, whatever text a reply or an error is built from.
function redact(text: string): string {
  const key = getSetting("SONARR_API_KEY");
  return key ? text.split(key).join("[redacted]") : text;
}
const reply = (text: string, isError = false) => textReply(redact(text), isError);

const countSeasons = (seasons: Array<{ seasonNumber?: number | undefined }>) =>
  seasons.filter((s) => Number(s.seasonNumber) > 0).length;
const seasonCount = (series: SonarrSeries): number | null =>
  Array.isArray(series.seasons) ? countSeasons(series.seasons) : null;
const seasonsText = (n: number | null) =>
  n === null ? "seasons unknown" : `${n} season${n === 1 ? "" : "s"}`;
const yearText = (year: unknown) => (typeof year === "number" && year > 0 ? String(year) : "N/A");
const tvdbIdOf = (series: SonarrSeries) =>
  typeof series.tvdbId === "number" && series.tvdbId > 0 ? series.tvdbId : null;
const titleOf = (series: SonarrSeries) => String(series.title ?? "").slice(0, TEXT_LENGTH);

async function lookup(term: string): Promise<SonarrSeries[]> {
  const response = await sonarrClient.get<SonarrSeries[]>("/api/v3/series/lookup", {
    params: { term },
  });
  return Array.isArray(response.data) ? response.data : [];
}

// The TVDB ids of the series Sonarr already has.
async function libraryTvdbIds(): Promise<Map<number, SonarrSeries>> {
  const response = await sonarrClient.get<SonarrSeries[]>("/api/v3/series");
  const byTvdbId = new Map<number, SonarrSeries>();
  for (const series of Array.isArray(response.data) ? response.data : []) {
    const id = tvdbIdOf(series);
    if (id !== null) byTvdbId.set(id, series);
  }
  return byTvdbId;
}

const clearSeriesGrid = db.transaction(() => {
  db.prepare("DELETE FROM series_selection_context").run();
  db.prepare("DELETE FROM series_add_preview").run();
});

// --- search_and_select_series -------------------------------------------------

export async function searchAndSelectSeries({ query }: { query: string }) {
  if (!isConfigured("SONARR")) return reply(NOT_CONFIGURED, true);
  try {
    // A new search makes the old numbers and any preview of them meaningless.
    clearSeriesGrid();

    // One row per show: a TVDB id the lookup returns again is left out.
    const seen = new Set<number>();
    const results = (await lookup(query)).filter((s) => {
      const id = tvdbIdOf(s);
      if (id === null || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (results.length === 0) {
      return reply(`No series matched "${query}" in Sonarr's lookup.`);
    }
    const owned = await libraryTvdbIds();
    const choices = results.slice(0, GRID_SIZE);
    const insert = db.prepare(
      "INSERT INTO series_selection_context (selection_index, tvdb_id, title, year) VALUES (?, ?, ?, ?)",
    );
    db.transaction(() => {
      choices.forEach((series, index) => {
        insert.run(index + 1, series.tvdbId, titleOf(series), yearText(series.year));
      });
    })();

    let output = `📺 **Series matching "${query}"** (from Sonarr's lookup)\n`;
    output +=
      "Ask the user which number(s) to add, then call confirm_selected_series with chosenIndexes for a preview. Nothing is added by this search or by the preview.\n\n";
    output += "| Choice | Poster | Series |\n";
    output += "| :---: | :---: | :--- |\n";
    choices.forEach((series, index) => {
      const title = escapeTableCell(titleOf(series) || "Untitled");
      const posterUrl =
        series.remotePoster ?? series.images?.find((i) => i.coverType === "poster")?.remoteUrl;
      const poster =
        typeof posterUrl === "string" && /^https:\/\/[^\s)]+$/.test(posterUrl)
          ? `![${title.replace(/[[\]]/g, "")}](${posterUrl})`
          : "*No poster*";
      const overviewClean = series.overview
        ? escapeTableCell(series.overview.replace(/\s+/g, " ").trim())
        : "No overview available.";
      const overview =
        overviewClean.length > OVERVIEW_LENGTH
          ? `${overviewClean.slice(0, OVERVIEW_LENGTH)}...`
          : overviewClean;
      const facts = [
        series.network
          ? escapeTableCell(String(series.network).slice(0, TEXT_LENGTH))
          : "network unknown",
        series.status ? escapeTableCell(String(series.status)) : "status unknown",
        seasonsText(seasonCount(series)),
        `TVDB ID: ${series.tvdbId}`,
      ].join(" · ");
      const inSonarr = owned.has(series.tvdbId as number) ? " <br> ✅ *Already in Sonarr*" : "";
      output += `| **[ Choice ${index + 1} ]** | ${poster} | **${title} (${yearText(series.year)})** <br> *${facts}*${inSonarr} <br><br> ${overview} |\n`;
    });
    return reply(output);
  } catch (error: unknown) {
    return reply(`Failed to search Sonarr for series: ${getErrorMessage(error)}`, true);
  }
}

// --- confirm_selected_series: resolving ------------------------------------------

export interface ConfirmSeriesArgs {
  previewId?: string | undefined;
  chosenIndexes?: number[] | undefined;
  qualityProfile?: string | undefined;
  rootFolder?: string | undefined;
  seriesType?: string | undefined;
  monitor?: string | undefined;
  searchForMissing?: boolean | undefined;
}

// The options of a preview, as the caller gave them.
type GivenOptions = Pick<
  ConfirmSeriesArgs,
  "qualityProfile" | "rootFolder" | "seriesType" | "monitor" | "searchForMissing"
>;

interface ChosenShow {
  tvdbId: number;
  title: string;
  year: string | null;
}

type Decision = "add" | "exists";

// A season as it is posted to Sonarr: its number and whether it is monitored,
// as Sonarr's lookup gave them, nothing else.
interface AddSeason {
  seasonNumber: number | undefined;
  monitored: boolean | undefined;
}

// A chosen show with its decision. record is Sonarr's lookup record for a show
// to add, and seasons are its seasons as they would be posted; both are null
// for a show already in Sonarr. seasonCount is what the preview shows.
interface DecidedShow extends ChosenShow {
  decision: Decision;
  seasonCount: number | null;
  seasons: AddSeason[] | null;
  record: SonarrSeries | null;
}

const addSeasons = (record: SonarrSeries): AddSeason[] =>
  (Array.isArray(record.seasons) ? record.seasons : []).map((s) => ({
    seasonNumber: s.seasonNumber,
    monitored: s.monitored,
  }));

interface Resolution {
  resolved: Resolved;
  shows: DecidedShow[];
}

interface Resolved {
  qualityProfileId: number;
  qualityProfile: string;
  // Sonarr's first profile was used because none was named and no default is set.
  profileIsFirst: boolean;
  rootFolder: string;
  seriesType: SeriesType;
  monitor: MonitorOption;
  searchForMissing: boolean;
}

// What a preview showed, as stored in series_add_preview.payload.
interface StoredPreview {
  given: GivenOptions & { chosenIndexes?: number[] | undefined };
  sonarrUrl: string;
  resolved: Resolved;
  shows: (ChosenShow & { decision: Decision; seasons: AddSeason[] | null })[];
}

const sameFolder = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

function pickFromList<T extends string>(
  what: string,
  settingName: string,
  allowed: readonly T[],
  asked: string | undefined,
  saved: string,
  fallback: T,
): { value: T } | { error: string } {
  const wanted = asked?.trim() || saved.trim();
  if (!wanted) return { value: fallback };
  const match = allowed.find((a) => a.toLowerCase() === wanted.toLowerCase());
  if (match) return { value: match };
  const origin = asked?.trim() ? "" : ` (that is the ${settingName} saved on the Settings page)`;
  return {
    error: `❌ "${wanted}" is not a ${what}${origin}. Allowed: ${allowed.join(", ")}.`,
  };
}

// Settles every setting of an add from what the caller gave, the saved
// defaults and what Sonarr has now, and decides each show. GET requests only.
async function resolveAdd(
  given: GivenOptions,
  shows: ChosenShow[],
): Promise<Resolution | { error: string }> {
  const profiles =
    (await sonarrClient.get<SonarrQualityProfile[]>("/api/v3/qualityprofile")).data ?? [];
  const choice = chooseQualityProfile(profiles, given.qualityProfile, "Sonarr");
  if ("error" in choice) return { error: choice.error };

  const folders = (await sonarrClient.get<SonarrRootFolder[]>("/api/v3/rootfolder")).data ?? [];
  const wantedFolder = given.rootFolder?.trim() || getSetting("SONARR_DEFAULT_ROOT_FOLDER").trim();
  const folder = wantedFolder
    ? folders.find((f) => sameFolder(String(f.path), wantedFolder))
    : folders[0];
  if (!folder) {
    const origin = given.rootFolder?.trim()
      ? ""
      : " (that is the default root folder saved on the Settings page)";
    return {
      error: wantedFolder
        ? `❌ No Sonarr root folder "${wantedFolder}"${origin}. Available: ${folders.map((f) => f.path).join(", ")}.`
        : "❌ Sonarr has no root folders configured.",
    };
  }

  const seriesType = pickFromList(
    "series type",
    "default series type",
    SERIES_TYPES,
    given.seriesType,
    getSetting("SONARR_DEFAULT_SERIES_TYPE"),
    "standard",
  );
  if ("error" in seriesType) return seriesType;
  const monitor = pickFromList(
    "monitor option",
    "default monitor option",
    MONITOR_OPTIONS,
    given.monitor,
    getSetting("SONARR_DEFAULT_MONITOR"),
    "all",
  );
  if ("error" in monitor) return monitor;

  const owned = await libraryTvdbIds();
  const decided: DecidedShow[] = [];
  for (const show of shows) {
    const existing = owned.get(show.tvdbId);
    if (existing) {
      decided.push({
        ...show,
        decision: "exists",
        seasonCount: seasonCount(existing),
        seasons: null,
        record: null,
      });
      continue;
    }
    const record = await lookupRecord(show);
    if (!record) {
      return {
        error: `❌ Sonarr's lookup no longer returns ${show.title} (TVDB id ${show.tvdbId}), so it can't be added. Run search_and_select_series again.`,
      };
    }
    const seasons = addSeasons(record);
    decided.push({
      ...show,
      decision: "add",
      seasonCount: Array.isArray(record.seasons) ? countSeasons(seasons) : null,
      seasons,
      record,
    });
  }

  return {
    resolved: {
      qualityProfileId: choice.profile.id,
      qualityProfile: choice.profile.name,
      profileIsFirst: choice.source === "first",
      rootFolder: String(folder.path),
      seriesType: seriesType.value,
      monitor: monitor.value,
      searchForMissing: given.searchForMissing ?? true,
    },
    shows: decided,
  };
}

// Sonarr's own lookup record for one chosen show: the result of looking its
// title up again that carries its TVDB id.
async function lookupRecord(show: ChosenShow): Promise<SonarrSeries | null> {
  const results = await lookup(show.title);
  return results.find((s) => s.tvdbId === show.tvdbId) ?? null;
}

const showLabel = (show: ChosenShow) =>
  `**${show.title} (${show.year ?? "N/A"})** [TVDB: ${show.tvdbId}]`;

function settingsLines(resolved: Resolved): string {
  const profileNote = resolved.profileIsFirst
    ? `${resolved.qualityProfile} (Sonarr's first profile, because no default is set on the Settings page)`
    : resolved.qualityProfile;
  return [
    `- Quality profile: ${profileNote}`,
    `- Root folder: ${resolved.rootFolder}`,
    `- Series type: ${resolved.seriesType}`,
    `- Monitor: ${MONITOR_WORDS[resolved.monitor]} (\`${resolved.monitor}\`)`,
    resolved.searchForMissing
      ? "- Search: a search for the monitored episodes starts as soon as each show is added. For a long-running show that can be a large download."
      : "- Search: no search is started; Sonarr only picks up episodes as they are released or when a search is started later.",
  ].join("\n");
}

// Stores a preview as the current one (replacing any other) and renders it.
// now (milliseconds) is when it was made: it can be confirmed for
// PREVIEW_LIFE_MINUTES after that.
function storePreview(given: StoredPreview["given"], resolution: Resolution, now: number): string {
  const id = randomUUID();
  const stored: StoredPreview = {
    given,
    sonarrUrl: getSetting("SONARR_URL"),
    resolved: resolution.resolved,
    shows: resolution.shows.map(({ tvdbId, title, year, decision, seasons }) => ({
      tvdbId,
      title,
      year,
      decision,
      seasons,
    })),
  };
  db.transaction(() => {
    db.prepare("DELETE FROM series_add_preview").run();
    db.prepare("INSERT INTO series_add_preview (id, payload, created_at) VALUES (?, ?, ?)").run(
      id,
      JSON.stringify(stored),
      now,
    );
  })();

  const adding = resolution.shows.filter((s) => s.decision === "add").length;
  let output = "## Preview: adding series to Sonarr (nothing has been added yet)\n";
  for (const show of resolution.shows) {
    output += `- ${showLabel(show)}, ${seasonsText(show.seasonCount)}: ${show.decision === "add" ? "will be added" : "already in Sonarr, will not be added"}\n`;
  }
  output += `\nSettings that will be used:\n${settingsLines(resolution.resolved)}\n\n`;
  output +=
    adding === 0
      ? "Nothing would be added: every chosen show is already in Sonarr.\n"
      : `Confirming adds ${adding} show${adding === 1 ? "" : "s"} as monitored, with season folders.\n`;
  output += `Show this preview to the user. Once they agree, call confirm_selected_series again with only previewId "${id}". That id belongs to this preview alone and is good for ${PREVIEW_LIFE_MINUTES} minutes: a new preview or a new search replaces it, and the add only goes through if nothing shown here has changed.`;
  return output;
}

// What differs between a stored preview and resolving it again now.
function differences(stored: StoredPreview, now: Resolution): string[] {
  const out: string[] = [];
  const url = getSetting("SONARR_URL");
  if (url !== stored.sonarrUrl) out.push("the Sonarr URL has changed");
  const a = stored.resolved;
  const b = now.resolved;
  if (a.qualityProfileId !== b.qualityProfileId || a.qualityProfile !== b.qualityProfile)
    out.push(
      `the quality profile is now ${b.qualityProfile} (the preview showed ${a.qualityProfile})`,
    );
  if (a.rootFolder !== b.rootFolder)
    out.push(`the root folder is now ${b.rootFolder} (the preview showed ${a.rootFolder})`);
  if (a.seriesType !== b.seriesType)
    out.push(`the series type is now ${b.seriesType} (the preview showed ${a.seriesType})`);
  if (a.monitor !== b.monitor)
    out.push(`the monitor option is now ${b.monitor} (the preview showed ${a.monitor})`);
  if (a.searchForMissing !== b.searchForMissing)
    out.push(
      `a search ${b.searchForMissing ? "would now" : "would no longer"} start (the preview showed ${a.searchForMissing ? "one" : "none"})`,
    );
  for (const before of stored.shows) {
    const after = now.shows.find((s) => s.tvdbId === before.tvdbId);
    if (!after) continue;
    if (after.decision === before.decision) {
      out.push(...seasonDifferences(before.title, before.seasons, after.seasons));
      continue;
    }
    out.push(
      after.decision === "exists"
        ? `${before.title} is now already in Sonarr (the preview showed it would be added)`
        : `${before.title} is no longer in Sonarr (the preview showed it as already there)`,
    );
  }
  return out;
}

const sameSeasons = (a: AddSeason[] | null, b: AddSeason[] | null) =>
  JSON.stringify(a) === JSON.stringify(b);

// What differs between the seasons a preview stored for a show and the ones
// Sonarr's lookup gives now.
function seasonDifferences(
  title: string,
  before: AddSeason[] | null,
  after: AddSeason[] | null,
): string[] {
  if (sameSeasons(before, after)) return [];
  const was = before ?? [];
  const is = after ?? [];
  if (countSeasons(was) !== countSeasons(is)) {
    return [
      `${title} now has ${seasonsText(countSeasons(is))} (the preview showed ${countSeasons(was)})`,
    ];
  }
  const numbers = (list: AddSeason[]) => list.map((s) => s.seasonNumber).join(", ");
  if (numbers(was) !== numbers(is)) {
    return [`${title}'s seasons are now ${numbers(is)} (the preview showed ${numbers(was)})`];
  }
  const state = (monitored: boolean | undefined) =>
    monitored === true
      ? "monitored"
      : monitored === false
        ? "not monitored"
        : "without a monitored flag";
  const flags = is.flatMap((season, i) =>
    season.monitored === was[i]?.monitored
      ? []
      : [
          `season ${season.seasonNumber} of ${title} is now ${state(season.monitored)} in Sonarr's lookup (the preview showed it ${state(was[i]?.monitored)})`,
        ],
  );
  return flags.length > 0 ? flags : [`the seasons of ${title} have changed`];
}

// The body of POST /api/v3/series: a fixed list of fields, nothing else from
// the lookup record (no path, id, tags or other fields Sonarr sent). The
// seasons are the ones the preview stored.
function addBody(record: SonarrSeries, seasons: AddSeason[], resolved: Resolved) {
  return {
    tvdbId: record.tvdbId,
    title: record.title,
    titleSlug: record.titleSlug,
    year: record.year,
    images: record.images,
    seasons,
    qualityProfileId: resolved.qualityProfileId,
    rootFolderPath: resolved.rootFolder,
    monitored: true,
    seasonFolder: true,
    seriesType: resolved.seriesType,
    addOptions: {
      monitor: resolved.monitor,
      searchForMissingEpisodes: resolved.searchForMissing,
      searchForCutoffUnmetEpisodes: false,
    },
  };
}

const PREVIEW_AGAIN =
  "Call confirm_selected_series with chosenIndexes (and any options) for a new preview, show it to the user, and confirm with the previewId it returns.";

// --- confirm_selected_series ---------------------------------------------------

// now (milliseconds) is the clock a preview's age is measured with.
export async function confirmSelectedSeries(args: ConfirmSeriesArgs, now: number = Date.now()) {
  if (!isConfigured("SONARR")) return reply(NOT_CONFIGURED, true);
  const { previewId, chosenIndexes, ...options } = args;
  const optionsGiven = Object.values(options).some((v) => v !== undefined);
  const hasPreviewId = previewId !== undefined;
  const hasIndexes = chosenIndexes !== undefined;

  if (hasPreviewId && (hasIndexes || optionsGiven)) {
    return reply(
      `❌ previewId confirms a preview exactly as it was shown, so it can't be combined with any other argument. Nothing was added and nothing was changed. To change something, ask for a new preview with chosenIndexes and the options, without previewId.`,
      true,
    );
  }
  if (!hasPreviewId && !hasIndexes) {
    return reply(
      `❌ Give either chosenIndexes (with any options) for a preview, or previewId alone to confirm one. Nothing was added.`,
      true,
    );
  }

  try {
    if (hasIndexes) return await previewSeries(chosenIndexes, options, now);
    return await confirmPreview(String(previewId), now);
  } catch (error: unknown) {
    // A confirmation has already used its preview up by the time Sonarr is read.
    const next = hasPreviewId ? ` That preview is used up. ${PREVIEW_AGAIN}` : "";
    return reply(
      `Sonarr could not be read, so nothing was added: ${radarrErrorMessage(error)}${next}`,
      true,
    );
  }
}

async function previewSeries(chosenIndexes: number[], options: GivenOptions, now: number) {
  const find = db.prepare("SELECT * FROM series_selection_context WHERE selection_index = ?");
  const shows: ChosenShow[] = [];
  for (const index of [...new Set(chosenIndexes)]) {
    const row = find.get(index) as SeriesSelectionRow | undefined;
    // One line per show, also if two numbers point to the same TVDB id.
    if (row && !shows.some((s) => s.tvdbId === row.tvdb_id)) {
      shows.push({ tvdbId: row.tvdb_id, title: row.title, year: row.year });
    }
  }
  if (shows.length === 0) {
    return reply(
      "❌ None of those numbers is in the last series grid. Run search_and_select_series again and choose from its numbers. Nothing was added.",
      true,
    );
  }
  const resolution = await resolveAdd(options, shows);
  if ("error" in resolution) return reply(`${resolution.error} Nothing was added.`, true);
  return reply(storePreview({ ...options, chosenIndexes }, resolution, now));
}

async function confirmPreview(previewId: string, now: number) {
  // Taken and removed in one statement: an id can be used once, and only
  // while it is the current preview.
  const taken = db
    .prepare("DELETE FROM series_add_preview WHERE id = ? RETURNING payload, created_at")
    .get(previewId) as { payload: string; created_at: unknown } | undefined;
  if (!taken) {
    return reply(
      `❌ That previewId is not the current preview: it is unknown, was replaced by a newer preview or search, or was already used. Nothing was added. ${PREVIEW_AGAIN}`,
      true,
    );
  }
  // An expired preview is removed like a used one, before Sonarr is asked anything.
  const age = now - Number(taken.created_at);
  if (!(age >= 0 && age <= PREVIEW_LIFE_MS)) {
    return reply(
      `❌ That preview has expired: a preview can be confirmed for ${PREVIEW_LIFE_MINUTES} minutes after it is made. Nothing was added. ${PREVIEW_AGAIN}`,
      true,
    );
  }
  let stored: StoredPreview;
  try {
    stored = JSON.parse(taken.payload) as StoredPreview;
  } catch {
    return reply(
      `❌ The stored preview could not be read. Nothing was added. ${PREVIEW_AGAIN}`,
      true,
    );
  }

  // Everything again, from what the caller gave then, against the settings and
  // Sonarr as they are now.
  const { chosenIndexes: _indexes, ...given } = stored.given;
  const shows = stored.shows.map(({ tvdbId, title, year }) => ({ tvdbId, title, year }));
  const fresh = await resolveAdd(given, shows);
  if ("error" in fresh) {
    return reply(
      `Nothing was added: what the preview showed can no longer be resolved. ${fresh.error} ${PREVIEW_AGAIN}`,
      true,
    );
  }
  const changed = differences(stored, fresh);
  if (changed.length > 0) {
    const preview = storePreview(stored.given, fresh, now);
    return reply(
      `Nothing was added: what the preview showed has changed since it was made.\n${changed.map((c) => `- ${c}`).join("\n")}\n\nThis is a new preview with a new id; the old id no longer works.\n\n${preview}`,
    );
  }

  const { resolved } = fresh;
  let report = `🚀 **Adding series to Sonarr** (profile: ${resolved.qualityProfile}, folder: ${resolved.rootFolder}, type: ${resolved.seriesType}, monitor: ${resolved.monitor}, ${resolved.searchForMissing ? "search for monitored episodes started" : "no search started"})\n`;
  for (const show of fresh.shows) {
    if (show.decision === "exists") {
      report += `  ⏭️ ${showLabel(show)} - already in Sonarr; not added.\n`;
      continue;
    }
    // Equal to what the preview stored: differences() found no change.
    const seasons = stored.shows.find((s) => s.tvdbId === show.tvdbId)?.seasons ?? [];
    try {
      await sonarrClient.post(
        "/api/v3/series",
        addBody(show.record as SonarrSeries, seasons, resolved),
      );
      report += `  ✅ ${showLabel(show)} - added${resolved.searchForMissing ? "; search for its monitored episodes started" : ""}.\n`;
    } catch (error: unknown) {
      // Sonarr answered with an error: the show was not added. No answer at all
      // (a timeout, a dropped connection): Sonarr may have added it. Never retried.
      report +=
        isAxiosError(error) && error.response
          ? `  ❌ ${showLabel(show)} - failed: ${radarrErrorMessage(error)}\n`
          : `  ❓ ${showLabel(show)} - outcome not known: Sonarr did not answer (${getErrorMessage(error)}). The show may have been added; a new search and preview will show it as already in Sonarr if it was.\n`;
    }
  }
  return reply(report);
}

// The two tools, for MCP clients only: they are not in movieTools, so the
// dashboard's chat does not get them.
export function registerSeriesAddTools() {
  server.registerTool(
    "search_and_select_series",
    {
      description:
        "Searches Sonarr's lookup for TV series to add and shows up to five as a numbered grid: poster, title and year, network, status, number of seasons, TVDB id and overview, with shows already in Sonarr marked. It adds nothing (GET requests only). Follow it with confirm_selected_series. A new search replaces the previous series grid and discards any preview made from it; the movie grid of search_and_select_movies is separate.",
      inputSchema: {
        query: z.string().describe("The series name to search for (e.g. 'Severance')."),
      },
    },
    async (args) => searchAndSelectSeries(args),
  );

  server.registerTool(
    "confirm_selected_series",
    {
      description:
        "Adds TV series from the last search_and_select_series grid to Sonarr, in two calls. " +
        "First call it with chosenIndexes (and, if the user asked, qualityProfile, rootFolder, seriesType, monitor, searchForMissing): this is a preview that changes nothing. It says which shows would be added and which are already in Sonarr, with the quality profile, root folder, series type, monitor option and whether a search will start, and it returns a previewId. Show that preview to the user. " +
        "Only after the user agrees, call it again with previewId alone (no other argument): this adds the shows as monitored series with season folders. It only goes through if that id is the current preview, at most 15 minutes old, and nothing the preview showed has changed; otherwise nothing is added and you get a new preview that says what differs (or, for an expired id, are asked for a new preview). " +
        "Defaults: the quality profile, root folder, series type and monitor option saved on the Settings page, else Sonarr's first profile and root folder, 'standard' and 'all'. searchForMissing defaults to true: Sonarr searches for the monitored episodes at once, which for a long-running show with monitor 'all' can be a large download.",
      inputSchema: {
        previewId: z
          .string()
          .optional()
          .describe(
            "The id a preview returned. Give it alone, after the user agreed to that preview, to add the shows.",
          ),
        chosenIndexes: z
          .array(z.number().int())
          .optional()
          .describe(
            "For a preview: the numbers the user picked from the series grid, e.g. [1, 3].",
          ),
        qualityProfile: z
          .string()
          .optional()
          .describe("Sonarr quality profile name to use instead of the default."),
        rootFolder: z
          .string()
          .optional()
          .describe(
            "Sonarr root folder path to add to instead of the default (e.g. '/media/tvshows').",
          ),
        seriesType: z
          .enum(SERIES_TYPES)
          .optional()
          .describe("Sonarr series type instead of the default: standard, daily or anime."),
        monitor: z
          .enum(MONITOR_OPTIONS)
          .optional()
          .describe(
            "Which episodes Sonarr monitors instead of the default: all, future, missing, existing, firstSeason, lastSeason, pilot or none.",
          ),
        searchForMissing: z
          .boolean()
          .optional()
          .describe(
            "Whether Sonarr starts a search for the monitored episodes when a show is added (default true).",
          ),
      },
    },
    async (args) => confirmSelectedSeries(args),
  );
}
