import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sonarrClient } from "../src/clients.js";
import { episodeNotes, getUpcomingEpisodes } from "../src/tools/upcoming.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb } from "./helpers.js";

// A fixed "now": Saturday 2026-09-19 15:00 UTC.
const NOW = Date.parse("2026-09-19T15:00:00Z");
const DAYS = 86_400_000;

let sonarr: ReturnType<typeof fakeApi>;
let calendar: any[];
let allSeries: any[];
let episodes: any[];

const show = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  year: 2020,
  status: "continuing",
  monitored: true,
  network: "HBO",
  alternateTitles: [],
  lastAired: "2025-03-20T00:00:00Z",
  ...extra,
});
let nextId = 1;
const ep = (series: any, season: number, number: number, airDateUtc: string | null, extra: Record<string, unknown> = {}) => ({
  id: nextId++,
  seriesId: series.id,
  seasonNumber: season,
  episodeNumber: number,
  title: `Title ${season}-${number}`,
  airDate: airDateUtc ? airDateUtc.slice(0, 10) : undefined,
  airDateUtc,
  hasFile: false,
  monitored: true,
  series,
  ...extra,
});

function sonarrFake(overrides?: (url: string) => any) {
  sonarr = fakeApi(sonarrClient, (req) => {
    const custom = overrides?.(req.url);
    if (custom) return custom;
    if (req.url === "/api/v3/calendar") return { data: calendar };
    if (req.url === "/api/v3/series") return { data: allSeries };
    if (req.url === "/api/v3/episode") return { data: episodes };
    return { status: 404 };
  });
}

beforeEach(async () => {
  await resetDb();
  setSetting("SONARR_URL", "http://sonarr:8989");
  nextId = 1;
  calendar = [];
  allSeries = [];
  episodes = [];
});
afterEach(() => sonarr?.restore());

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => r.structuredContent.media as Array<Record<string, any>>;
const lines = (r: any) => text(r).split("\n").filter((l) => l.startsWith("- "));

describe("episodeNotes", () => {
  it("flags finales and premieres from Sonarr's finale type and the episode number", () => {
    assert.deepEqual(episodeNotes({ finaleType: "season", seasonNumber: 4, episodeNumber: 10 }), ["season finale"]);
    assert.deepEqual(episodeNotes({ finaleType: "series", seasonNumber: 4, episodeNumber: 10 }), ["series finale"]);
    assert.deepEqual(episodeNotes({ finaleType: "midseason", seasonNumber: 4, episodeNumber: 5 }), ["mid-season finale"]);
    assert.deepEqual(episodeNotes({ seasonNumber: 25, episodeNumber: 1 }), ["season premiere"]);
    assert.deepEqual(episodeNotes({ seasonNumber: 1, episodeNumber: 1 }), ["series premiere"]);
    assert.deepEqual(episodeNotes({ seasonNumber: 1, episodeNumber: 1, finaleType: "series" }), ["series finale", "series premiere"], "a one-episode special is both");
    assert.deepEqual(episodeNotes({ seasonNumber: 3, episodeNumber: 4 }), []);
    assert.deepEqual(episodeNotes({ seasonNumber: 0, episodeNumber: 1 }), [], "a special is not a premiere");
  });
});

describe("get_upcoming_episodes: the calendar", () => {
  it("says so when Sonarr isn't configured, without calling it", async () => {
    setSetting("SONARR_URL", "");
    sonarrFake();
    const result = await getUpcomingEpisodes({}, NOW);
    assert.equal(result.isError, true);
    assert.equal(sonarr.calls.length, 0);
  });

  it("asks Sonarr from this moment through the number of days, with the series included, so nothing already aired is listed", async () => {
    sonarrFake();
    await getUpcomingEpisodes({ days: 3 }, NOW);
    const params = sonarr.calls[0]!.params;
    assert.equal(params.start, "2026-09-19T15:00:00.000Z");
    assert.equal(params.end, "2026-09-22T15:00:00.000Z");
    assert.equal(params.includeSeries, true);
    await getUpcomingEpisodes({}, NOW);
    assert.equal(sonarr.calls[1]!.params.end, "2026-09-26T15:00:00.000Z", "a week by default");
  });

  it("clamps the number of days to 1..60", async () => {
    sonarrFake();
    await getUpcomingEpisodes({ days: 0 }, NOW);
    await getUpcomingEpisodes({ days: 999 }, NOW);
    await getUpcomingEpisodes({ days: -4 }, NOW);
    assert.deepEqual(sonarr.calls.map((c) => c.params.end), ["2026-09-20T15:00:00.000Z", "2026-11-18T15:00:00.000Z", "2026-09-20T15:00:00.000Z"]);
  });

  it("lists episodes by day in air order, with network, weekday and the episode name", async () => {
    const a = show(1, "Lioness", { network: "Paramount+" });
    const b = show(2, "Ted Lasso", { network: "Apple TV" });
    const c = show(3, "Dark Matter (2024)", { network: "Apple TV" });
    calendar = [
      ep(c, 2, 5, "2026-09-25T04:00:00Z"),
      ep(b, 4, 8, "2026-09-23T04:00:00Z"),
      ep(a, 3, 8, "2026-09-20T07:00:00Z"),
    ];
    sonarrFake();
    const result = await getUpcomingEpisodes({}, NOW);
    assert.match(text(result), /^## Airing in the next 7 days \(2026-09-19 to 2026-09-26\) - 3 episodes from shows Sonarr monitors\n/);
    assert.deepEqual(lines(result), [
      '- Lioness S3E08 "Title 3-8" (Paramount+)',
      '- Ted Lasso S4E08 "Title 4-8" (Apple TV)',
      '- Dark Matter (2024) S2E05 "Title 2-5" (Apple TV)',
    ]);
    assert.match(text(result), /\nSunday 2026-09-20\n- Lioness/);
    assert.match(text(result), /\nWednesday 2026-09-23\n- Ted Lasso/);
    assert.match(text(result), /\nFriday 2026-09-25\n- Dark Matter/);
  });

  // Found live: a 9pm Central show airs on the 21st locally but 02:00 UTC on the 22nd.
  it("groups by Sonarr's local air date, not the UTC date, but orders by UTC time", async () => {
    const sunny = show(1, "It's Always Sunny");
    const late = show(2, "Late Show");
    const early = show(3, "Early Show");
    calendar = [
      { ...ep(sunny, 18, 7, "2026-09-22T02:00:00Z"), airDate: "2026-09-21" },
      ep(early, 1, 3, "2026-09-21T18:00:00Z"),
      ep(late, 1, 4, "2026-09-22T05:00:00Z"),
    ];
    sonarrFake();
    const out = text(await getUpcomingEpisodes({}, NOW));
    assert.match(out, /Monday 2026-09-21\n- Early Show[^\n]*\n- It's Always Sunny[^\n]*\n\nTuesday 2026-09-22\n- Late Show/);
  });

  it("breaks a tie on the air time by show name", async () => {
    const z = show(1, "Zed");
    const a = show(2, "Alpha");
    calendar = [ep(z, 1, 2, "2026-09-20T01:00:00Z"), ep(a, 1, 2, "2026-09-20T01:00:00Z")];
    sonarrFake();
    assert.deepEqual(lines(await getUpcomingEpisodes({}, NOW)).map((l) => l.split(" S1E")[0]), ["- Alpha", "- Zed"]);
  });

  it("flags premieres, finales and episodes that are already downloaded", async () => {
    const a = show(1, "Star Trek: Strange New Worlds");
    const b = show(2, "Hell's Kitchen (US)");
    const c = show(3, "Early Bird");
    calendar = [
      ep(a, 4, 10, "2026-09-24T07:00:00Z", { finaleType: "season" }),
      ep(b, 25, 1, "2026-09-25T00:00:00Z"),
      ep(c, 2, 3, "2026-09-19T20:00:00Z", { hasFile: true }),
    ];
    sonarrFake();
    const out = lines(await getUpcomingEpisodes({}, NOW));
    assert.match(out[0]!, /Early Bird S2E03.* - already downloaded$/);
    assert.match(out[1]!, /Strange New Worlds S4E10.* - season finale$/);
    assert.match(out[2]!, /Hell's Kitchen \(US\) S25E01.* - season premiere$/);
  });

  it("leaves out shows Sonarr does not monitor, and says how many", async () => {
    const watched = show(1, "Watched");
    const ignored = show(2, "Ignored Show", { monitored: false });
    const half = show(3, "Half", { monitored: true });
    calendar = [ep(watched, 1, 1, "2026-09-20T01:00:00Z"), ep(ignored, 1, 2, "2026-09-20T02:00:00Z", { monitored: true }), ep(half, 1, 3, "2026-09-20T03:00:00Z", { monitored: false })];
    sonarrFake();
    const result = await getUpcomingEpisodes({}, NOW);
    assert.deepEqual(lines(result).map((l) => l.split(" S1E")[0]), ["- Watched"]);
    assert.match(text(result), /1 episode from shows Sonarr monitors/);
    assert.match(text(result), /2 more episodes air from shows Sonarr does not monitor; set monitored to 'unmonitored' or 'any' to list them\./);
    assert.equal(rows(result).length, 1);
  });

  it("lists everything with monitored 'any', without the 'more' note", async () => {
    const watched = show(1, "Watched");
    const ignored = show(2, "Ignored Show", { monitored: false });
    calendar = [ep(watched, 1, 1, "2026-09-20T01:00:00Z"), ep(ignored, 1, 2, "2026-09-20T02:00:00Z")];
    sonarrFake();
    const result = await getUpcomingEpisodes({ monitored: "any" }, NOW);
    assert.equal(lines(result).length, 2);
    assert.doesNotMatch(text(result), /does not monitor/);
    assert.match(text(result), /2 episodes\n/);
    assert.doesNotMatch(text(result), /from shows Sonarr monitors/);
  });

  // Found in the browser: "anything from shows I don't monitor?" also listed monitored shows.
  it("lists ONLY unmonitored shows with monitored 'unmonitored', so the table matches the question", async () => {
    const watched = show(1, "Watched");
    const ignored = show(2, "Ignored Show", { monitored: false });
    const half = show(3, "Half Watched", { monitored: true });
    calendar = [ep(watched, 1, 1, "2026-09-20T01:00:00Z"), ep(ignored, 1, 2, "2026-09-20T02:00:00Z"), ep(half, 1, 3, "2026-09-20T03:00:00Z", { monitored: false })];
    sonarrFake();
    const result = await getUpcomingEpisodes({ monitored: "unmonitored" }, NOW);
    assert.deepEqual(lines(result).map((l) => l.split(" S1E")[0]), ["- Ignored Show", "- Half Watched"]);
    assert.deepEqual(rows(result).map((r) => r.title), ["Ignored Show", "Half Watched"]);
    assert.match(text(result), /2 episodes from shows Sonarr does not monitor\n/);
    assert.doesNotMatch(text(result), /more episodes? airs?/);
    sonarr.restore();
    calendar = [ep(watched, 1, 1, "2026-09-20T01:00:00Z")];
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({ monitored: "unmonitored" }, NOW)), /^Nothing is scheduled to air in the next 7 days from shows Sonarr does not monitor/);
  });

  it("returns one table row per episode with the episode, date and notes in the details", async () => {
    const a = show(1, "Lioness", { network: "Paramount+", year: 2023 });
    calendar = [ep(a, 3, 8, "2026-09-20T07:00:00Z", { finaleType: "season" })];
    sonarrFake();
    assert.deepEqual(rows(await getUpcomingEpisodes({}, NOW)), [
      {
        kind: "show",
        title: "Lioness",
        year: 2023,
        posterUrl: null,
        libraries: null,
        genres: [],
        rating: null,
        detail: 'S3E08 "Title 3-8" - Sunday 2026-09-20 - season finale',
        show: { seasons: null, episodes: null, watchedEpisodes: null, network: "Paramount+" },
      },
    ]);
  });

  it("says so when nothing is scheduled, still mentioning unmonitored shows", async () => {
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({}, NOW)), /^Nothing is scheduled to air in the next 7 days from shows Sonarr monitors \(2026-09-19 to 2026-09-26\)\.$/);
    sonarr.restore();
    calendar = [ep(show(2, "Ignored", { monitored: false }), 1, 1, "2026-09-20T02:00:00Z")];
    sonarrFake();
    const result = await getUpcomingEpisodes({ days: 1 }, NOW);
    assert.match(text(result), /^Nothing is scheduled to air in the next 1 day from shows Sonarr monitors/);
    assert.match(text(result), /1 more episode airs from shows Sonarr does not monitor; set monitored to 'unmonitored' or 'any' to list it\./);
    assert.equal((result as any).structuredContent, undefined);
  });

  it("caps a long list and says how many were left out", async () => {
    const s = show(1, "Daily");
    calendar = Array.from({ length: 130 }, (_, i) => ep(s, 1, i + 1, new Date(NOW + (i + 1) * 3_600_000).toISOString()));
    sonarrFake();
    const result = await getUpcomingEpisodes({ days: 60 }, NOW);
    assert.equal(lines(result).length, 100);
    assert.equal(rows(result).length, 100);
    assert.match(text(result), /130 episodes from shows Sonarr monitors/);
    assert.match(text(result), /\.\.\.and 30 more not listed/);
  });

  it("copes with an episode that has no series attached or no air date", async () => {
    calendar = [{ id: 1, seasonNumber: 1, episodeNumber: 1, airDateUtc: "2026-09-20T01:00:00Z", monitored: true }, { id: 2, seasonNumber: 1, episodeNumber: 2, monitored: true, series: show(1, "X") }];
    sonarrFake();
    const result = await getUpcomingEpisodes({ monitored: "any" }, NOW);
    assert.equal(lines(result).length, 2);
    assert.match(text(result), /Unknown show S1E01/);
  });

  it("reports a Sonarr outage as an error", async () => {
    sonarrFake(() => ({ status: 500 }));
    const result = await getUpcomingEpisodes({}, NOW);
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to check Sonarr/);
  });
});

describe("get_upcoming_episodes: one show", () => {
  it("gives the next episode, then the ones after it", async () => {
    const s = show(1, "Star Trek: Strange New Worlds");
    allSeries = [s];
    episodes = [
      ep(s, 4, 8, "2026-09-10T07:00:00Z"),
      ep(s, 4, 10, "2026-09-24T07:00:00Z", { finaleType: "season" }),
      ep(s, 4, 9, "2026-09-17T07:00:00Z"),
      ep(s, 5, 1, "2027-06-01T07:00:00Z"),
    ];
    sonarrFake();
    const result = await getUpcomingEpisodes({ title: "strange new worlds" }, NOW);
    assert.match(text(result), /^## Star Trek: Strange New Worlds \(2020\) - Sonarr: continuing, monitored\n/);
    assert.match(text(result), /Next episode: S4E10 "Title 4-10" airs Thursday 2026-09-24 \(season finale\)\./);
    assert.match(text(result), /- S5E01 "Title 5-1" - Tuesday 2027-06-01 - season premiere/);
    assert.deepEqual(rows(result).map((r) => r.detail), ['S4E10 "Title 4-10" - Thursday 2026-09-24 - season finale', 'S5E01 "Title 5-1" - Tuesday 2027-06-01 - season premiere']);
    assert.doesNotMatch(text(result), /not monitoring/, "a monitored show gets no warning");
  });

  it("orders the upcoming episodes by air time whatever order Sonarr returns them in", async () => {
    const s = show(1, "Jumbled");
    allSeries = [s];
    episodes = [ep(s, 2, 4, "2026-11-01T02:00:00Z"), ep(s, 2, 2, "2026-10-01T02:00:00Z"), ep(s, 2, 3, "2026-10-15T02:00:00Z")];
    sonarrFake();
    const result = await getUpcomingEpisodes({ title: "Jumbled" }, NOW);
    assert.match(text(result), /Next episode: S2E02/);
    assert.deepEqual(rows(result).map((r) => r.detail.slice(0, 5)), ["S2E02", "S2E03", "S2E04"]);
  });

  it("says a new season starts when the next episode is a season's first", async () => {
    const s = show(1, "Severance");
    allSeries = [s];
    episodes = [ep(s, 2, 10, "2025-03-21T07:00:00Z"), ep(s, 3, 1, "2027-01-10T02:00:00Z")];
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({ title: "Severance" }, NOW)), /Season 3 starts: S3E01 "Title 3-1" airs Sunday 2027-01-10 \(season premiere\)\./);
  });

  it("says nothing is scheduled for a continuing show with no date, with when it last aired (Severance)", async () => {
    const s = show(1, "Severance", { lastAired: "2025-03-20T00:00:00Z" });
    allSeries = [s];
    episodes = [ep(s, 2, 10, "2025-03-21T07:00:00Z")];
    sonarrFake();
    const result = await getUpcomingEpisodes({ title: "Severance" }, NOW);
    assert.match(text(result), /No new episode is scheduled yet; the last one aired 2025-03-20\. Sonarr has no date for the next one\./);
    assert.equal((result as any).structuredContent, undefined);
  });

  it("says an ended show is not coming back", async () => {
    const s = show(1, "Breaking Bad", { status: "ended", lastAired: "2013-09-29T00:00:00Z" });
    allSeries = [s];
    episodes = [ep(s, 5, 16, "2013-09-30T02:00:00Z")];
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({ title: "Breaking Bad" }, NOW)), /It has ended \(last aired 2013-09-29\); no more episodes are coming\./);
  });

  it("handles a show that has not aired yet", async () => {
    const s = show(1, "Brand New", { status: "upcoming", lastAired: undefined });
    allSeries = [s];
    episodes = [ep(s, 1, 1, null)];
    sonarrFake();
    const out = text(await getUpcomingEpisodes({ title: "Brand New" }, NOW));
    assert.match(out, /It has not aired yet and no air date is set in Sonarr\./);
    assert.match(out, /1 episode has no air date yet\./);
  });

  it("counts episodes with no air date, but not ones that are already downloaded", async () => {
    const s = show(1, "Some Show");
    allSeries = [s];
    episodes = [ep(s, 1, 1, "2020-01-01T00:00:00Z"), ep(s, 1, 2, null), ep(s, 1, 3, null), ep(s, 1, 4, null, { hasFile: true }), ep(s, 0, 1, null)];
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({ title: "Some Show" }, NOW)), /2 episodes have no air date yet\./);
  });

  it("warns when Sonarr is not monitoring the show", async () => {
    const s = show(1, "Unwatched", { monitored: false });
    allSeries = [s];
    episodes = [ep(s, 2, 3, "2026-10-01T02:00:00Z")];
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({ title: "Unwatched" }, NOW)), /Sonarr is not monitoring it, so it would not download new episodes\./);
  });

  it("does not count specials as upcoming episodes", async () => {
    const s = show(1, "Specials Only Ahead");
    allSeries = [s];
    episodes = [ep(s, 1, 1, "2020-01-01T00:00:00Z"), ep(s, 0, 1, "2026-10-01T02:00:00Z")];
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({ title: "Specials Only Ahead" }, NOW)), /No new episode is scheduled yet/);
  });

  it("caps the list of upcoming episodes for one show", async () => {
    const s = show(1, "Long Run");
    allSeries = [s];
    episodes = Array.from({ length: 14 }, (_, i) => ep(s, 2, i + 2, new Date(NOW + (i + 1) * DAYS).toISOString()));
    sonarrFake();
    const result = await getUpcomingEpisodes({ title: "Long Run" }, NOW);
    assert.equal(lines(result).length, 9, "the next one is the headline, then nine more would be 10 in all");
    assert.match(text(result), /\.\.\.and 4 more scheduled through 2026-10-03\./);
    assert.equal(rows(result).length, 10);
  });

  it("asks which show when the title is ambiguous, and says when Sonarr does not have it", async () => {
    allSeries = [show(1, "Fargo", { year: 2014 }), show(2, "Fargo", { year: 2023 })];
    sonarrFake();
    assert.match(text(await getUpcomingEpisodes({ title: "Fargo" }, NOW)), /matches 2 series in Sonarr/);
    assert.match(text(await getUpcomingEpisodes({ title: "Zzz" }, NOW)), /No series matching "Zzz" in Sonarr\./);
    assert.equal(sonarr.calls.filter((c) => c.url === "/api/v3/episode").length, 0);
  });

  it("reports a Sonarr outage as an error", async () => {
    sonarrFake(() => ({ status: 500 }));
    const result = await getUpcomingEpisodes({ title: "Anything" }, NOW);
    assert.equal(result.isError, true);
  });
});
