import { sonarrClient } from "../clients.js";
import { isConfigured } from "../settings.js";
import { textReply, getErrorMessage } from "../util.js";
import type { MediaRow } from "./plex.js";
import { fetchEpisodes, label, NOT_CONFIGURED, resolveSeries } from "./series.js";

// "What's on this week?" and "when does <show> come back?", from Sonarr's
// calendar and episode lists. Dates are Sonarr's `airDate`: the day in the
// network's own time zone, which is what Sonarr's own calendar shows. (The UTC
// time can fall on the next day, e.g. a 9pm Central show.) Episodes are ordered
// by their UTC time.

const DEFAULT_DAYS = 7;
const MAX_DAYS = 60;
const MAX_LISTED = 100;
const MAX_SHOW_EPISODES = 10;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface UpcomingOptions {
  // How many days ahead to look when no show is named (default 7, max 60).
  days?: number;
  // A show to ask about instead: its next episodes, or that none is scheduled.
  title?: string;
  year?: number;
  // Only shows Sonarr monitors (the default; the number left out is reported),
  // only ones it does not, or all of them.
  monitored?: "monitored" | "unmonitored" | "any";
}

const dateOf = (episode: any): string => {
  const airDate = typeof episode.airDate === "string" && episode.airDate ? episode.airDate : null;
  return (airDate ?? String(episode.airDateUtc ?? "")).slice(0, 10);
};
const utc = (episode: any): number => (episode.airDateUtc ? Date.parse(episode.airDateUtc) : Number.POSITIVE_INFINITY);
const code = (episode: any) => `S${episode.seasonNumber}E${String(episode.episodeNumber).padStart(2, "0")}`;
const named = (episode: any) => `${code(episode)}${episode.title ? ` "${episode.title}"` : ""}`;
const weekday = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? "" : `${WEEKDAYS[day]} `;
};

// What is special about an episode, when Sonarr or its number says so.
export function episodeNotes(episode: any): string[] {
  const notes: string[] = [];
  if (episode.finaleType === "series") notes.push("series finale");
  else if (episode.finaleType === "season") notes.push("season finale");
  else if (episode.finaleType === "midseason") notes.push("mid-season finale");
  if (episode.seasonNumber > 0 && episode.episodeNumber === 1) notes.push(episode.seasonNumber === 1 ? "series premiere" : "season premiere");
  return notes;
}

function toRow(episode: any, series: any): MediaRow {
  const notes = episodeNotes(episode);
  return {
    kind: "show",
    title: String(series?.title ?? "Unknown show"),
    year: typeof series?.year === "number" && series.year > 0 ? series.year : null,
    posterUrl: null,
    libraries: null,
    genres: [],
    rating: null,
    detail: `${named(episode)} - ${weekday(dateOf(episode))}${dateOf(episode)}${notes.length > 0 ? ` - ${notes.join(", ")}` : ""}`,
    show: { seasons: null, episodes: null, watchedEpisodes: null, network: typeof series?.network === "string" && series.network ? series.network : null },
  };
}

export async function getUpcomingEpisodes(options: UpcomingOptions = {}, now: number = Date.now()) {
  if (!isConfigured("SONARR")) return textReply(NOT_CONFIGURED, true);
  try {
    return options.title ? await upcomingForShow(options.title, options.year, now) : await upcomingCalendar(options, now);
  } catch (error: unknown) {
    return textReply(`Failed to check Sonarr: ${getErrorMessage(error)}`, true);
  }
}

async function upcomingCalendar(options: UpcomingOptions, now: number) {
  const days = Math.min(Math.max(Math.trunc(options.days ?? DEFAULT_DAYS), 1), MAX_DAYS);
  const mode = options.monitored ?? "monitored";
  // From this moment on: what has already aired is not "on".
  const start = new Date(now);
  const end = new Date(start.getTime() + days * DAY_MS);

  const response = await sonarrClient.get("/api/v3/calendar", {
    params: { start: start.toISOString(), end: end.toISOString(), includeSeries: true, unmonitored: true },
  });
  const all = ((response.data ?? []) as any[]).sort((a, b) => utc(a) - utc(b) || String(a.series?.title).localeCompare(String(b.series?.title)));
  const tracked = (episode: any) => Boolean(episode.series?.monitored && episode.monitored);
  const shown = mode === "any" ? all : all.filter((episode) => (mode === "monitored") === tracked(episode));
  const hidden = mode === "monitored" ? all.length - shown.length : 0;

  const range = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
  const scope = mode === "any" ? "" : mode === "monitored" ? " from shows Sonarr monitors" : " from shows Sonarr does not monitor";
  const hiddenNote = hidden > 0 ? `${hidden} more episode${hidden === 1 ? " airs" : "s air"} from shows Sonarr does not monitor; set monitored to 'unmonitored' or 'any' to list ${hidden === 1 ? "it" : "them"}.\n` : "";
  if (shown.length === 0) {
    return textReply(`Nothing is scheduled to air in the next ${days} day${days === 1 ? "" : "s"}${scope} (${range}).\n${hiddenNote}`.trimEnd());
  }

  const listed = shown.slice(0, MAX_LISTED);
  let output = `## Airing in the next ${days} day${days === 1 ? "" : "s"} (${range}) - ${shown.length} episode${shown.length === 1 ? "" : "s"}${scope}\n`;
  output += "Each line is one episode; the user sees the same list in a table below your reply. Dates are Sonarr's air dates in the network's own time zone.\n";
  let currentDate = "";
  for (const episode of listed) {
    const date = dateOf(episode);
    if (date !== currentDate) {
      currentDate = date;
      output += `\n${weekday(date)}${date}\n`;
    }
    const notes = [...episodeNotes(episode), ...(episode.hasFile ? ["already downloaded"] : [])];
    const network = episode.series?.network ? ` (${episode.series.network})` : "";
    output += `- ${episode.series?.title ?? "Unknown show"} ${named(episode)}${network}${notes.length > 0 ? ` - ${notes.join(", ")}` : ""}\n`;
  }
  if (shown.length > listed.length) output += `\n...and ${shown.length - listed.length} more not listed (use fewer days).\n`;
  if (hiddenNote) output += `\n${hiddenNote}`;

  return { ...textReply(output), structuredContent: { media: listed.map((episode) => toRow(episode, episode.series)), append: false } };
}

async function upcomingForShow(title: string, year: number | undefined, now: number) {
  const resolved = await resolveSeries(title, year);
  if ("reply" in resolved) return resolved.reply;
  const { series } = resolved;

  const episodes = await fetchEpisodes(series.id);
  const regular = episodes.filter((e) => e.seasonNumber > 0);
  const upcoming = regular.filter((e) => e.airDateUtc && Date.parse(e.airDateUtc) > now).sort((a, b) => utc(a) - utc(b));
  const undated = regular.filter((e) => !e.airDateUtc && !e.hasFile).length;
  const monitoring = series.monitored ? "" : " Sonarr is not monitoring it, so it would not download new episodes.";

  let output = `## ${label(series)} - Sonarr: ${[series.status, series.monitored ? "monitored" : "not monitored"].filter(Boolean).join(", ")}\n`;
  if (upcoming.length > 0) {
    const next = upcoming[0]!;
    const notes = episodeNotes(next);
    const startsSeason = next.episodeNumber === 1 && next.seasonNumber > 1;
    output += `${startsSeason ? `Season ${next.seasonNumber} starts` : "Next episode"}: ${named(next)} airs ${weekday(dateOf(next))}${dateOf(next)}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}.${monitoring}\n`;
    const rest = upcoming.slice(1, MAX_SHOW_EPISODES);
    for (const episode of rest) {
      const restNotes = episodeNotes(episode);
      output += `- ${named(episode)} - ${weekday(dateOf(episode))}${dateOf(episode)}${restNotes.length > 0 ? ` - ${restNotes.join(", ")}` : ""}\n`;
    }
    if (upcoming.length > MAX_SHOW_EPISODES) output += `...and ${upcoming.length - MAX_SHOW_EPISODES} more scheduled through ${dateOf(upcoming[upcoming.length - 1])}.\n`;
  } else if (series.status === "ended") {
    output += `It has ended${series.lastAired ? ` (last aired ${String(series.lastAired).slice(0, 10)})` : ""}; no more episodes are coming.\n`;
  } else if (series.status === "upcoming" || regular.every((e) => !e.airDateUtc || Date.parse(e.airDateUtc) > now)) {
    output += `It has not aired yet and no air date is set in Sonarr.${monitoring}\n`;
  } else {
    output += `No new episode is scheduled yet${series.lastAired ? `; the last one aired ${String(series.lastAired).slice(0, 10)}` : ""}. Sonarr has no date for the next one.${monitoring}\n`;
  }
  if (undated > 0) output += `${undated} episode${undated === 1 ? " has" : "s have"} no air date yet.\n`;
  output += "Dates are Sonarr's air dates in the network's own time zone.\n";

  const media = upcoming.slice(0, MAX_SHOW_EPISODES).map((episode) => toRow(episode, series));
  return media.length > 0 ? { ...textReply(output), structuredContent: { media, append: false } } : textReply(output);
}
