import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plexClient, sonarrClient, tautulliClient } from "../src/clients.js";
import { findSeriesBySize, type SeriesSizeOptions } from "../src/tools/seriesSize.js";
import { movieTools } from "../src/tools/movies.js";
import { NOT_CONFIGURED } from "../src/tools/series.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb, type FakeReply, type RecordedRequest } from "./helpers.js";

// find_series_by_size (B1-B10): the biggest shows from Sonarr, and the big
// shows nobody has watched in N years from Plex and, when it is configured,
// Tautulli. Sonarr, Plex and Tautulli are the suite's fakes; nothing here
// reaches a real service.

const NOW = Date.parse("2026-11-01T00:00:00Z");
const GB = 1e9;
// Epoch seconds, `years` years before NOW.
const yearsAgo = (years: number) => Math.round((NOW - years * 365.25 * 86_400_000) / 1000);
const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

const SECTIONS = [
  { key: "1", type: "movie", title: "Movies" },
  { key: "3", type: "show", title: "TV Shows" },
  { key: "4", type: "show", title: "4k TV Shows" },
];

const series = (
  id: number,
  title: string,
  tvdbId: number,
  sizeGb: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  title,
  year: 2010,
  tvdbId,
  status: "ended",
  monitored: false,
  path: `/media/tvshows/${title}`,
  statistics: { episodeFileCount: Math.round(sizeGb * 2), sizeOnDisk: sizeGb * GB },
  ...extra,
});

// A show as Plex lists it. watched: the last time it was watched (epoch
// seconds), "undated" for watched with no date, or null for never watched.
const plexShow = (
  ratingKey: string,
  title: string,
  tvdb: number | null,
  watched: number | "undated" | null,
  addedAt: number,
  extra: Record<string, unknown> = {},
) => ({
  ratingKey,
  title,
  year: 2010,
  leafCount: 20,
  viewedLeafCount: watched === null ? 0 : 5,
  ...(typeof watched === "number" ? { lastViewedAt: watched } : {}),
  addedAt,
  Guid: tvdb === null ? [] : [{ id: `tvdb://${tvdb}` }],
  ...extra,
});

const row = (ratingKey: string, plays: number | null, lastPlayed: number | null = null) => ({
  rating_key: ratingKey,
  play_count: plays,
  last_played: lastPlayed,
});
const tautulliOk = (rows: unknown[], recordsTotal = rows.length): FakeReply => ({
  data: {
    response: {
      result: "success",
      message: null,
      data: { recordsTotal, recordsFiltered: recordsTotal, data: rows },
    },
  },
});

let sonarr: ReturnType<typeof fakeApi>;
let plex: ReturnType<typeof fakeApi>;
let tautulli: ReturnType<typeof fakeApi>;
let allSeries: any[];
let library: Record<string, any[]>;
// Section id -> what Tautulli answers for that library.
let tautulliLibrary: Record<string, FakeReply | (() => FakeReply)>;
let plexReply: ((req: RecordedRequest) => FakeReply) | null;

beforeEach(async () => {
  await resetDb();
  setSetting("SONARR_URL", "http://sonarr:8989");
  setSetting("PLEX_URL", "http://plex:32400");
  allSeries = [];
  library = { "1": [], "3": [], "4": [] };
  tautulliLibrary = {};
  plexReply = null;
  sonarr = fakeApi(sonarrClient, (req) => {
    if (req.url === "/api/v3/series") return { data: allSeries };
    return { status: 404 };
  });
  plex = fakeApi(plexClient, (req) => {
    if (plexReply) return plexReply(req);
    if (req.url === "/library/sections")
      return { data: { MediaContainer: { Directory: SECTIONS } } };
    const m = req.url.match(/^\/library\/sections\/(\d+)\/all$/);
    if (m) {
      const items = library[m[1]!] ?? [];
      return { data: { MediaContainer: { totalSize: items.length, Metadata: items } } };
    }
    return { status: 404 };
  });
  tautulli = fakeApi(tautulliClient, (req) => {
    if (req.params.cmd !== "get_library_media_info") return { status: 404 };
    const answer = tautulliLibrary[String(req.params.section_id)] ?? tautulliOk([]);
    return typeof answer === "function" ? answer() : answer;
  });
});
afterEach(() => {
  sonarr?.restore();
  plex?.restore();
  tautulli?.restore();
});

const run = (options: SeriesSizeOptions = {}) => findSeriesBySize(options, NOW);
const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => (r.structuredContent?.media ?? []) as any[];
const titles = (r: any) => rows(r).map((m) => m.title);
const lines = (r: any) =>
  text(r)
    .split("\n")
    .filter((l) => l.startsWith("- "));
const allCalls = () => [...sonarr.calls, ...plex.calls, ...tautulli.calls];
const useTautulli = () => setSetting("TAUTULLI_URL", "http://tautulli:8181");

function sizeStock() {
  allSeries = [
    series(1, "Small", 101, 5),
    series(2, "Huge", 102, 400, { status: "continuing", monitored: true }),
    series(3, "Middle B", 103, 50, { path: "/media/tvshowskids/Middle B" }),
    series(4, "Middle A", 104, 50, { monitored: true }),
    series(5, "Nothing Yet", 105, 0, {
      status: "upcoming",
      statistics: { episodeFileCount: 0, sizeOnDisk: 0 },
    }),
  ];
}

// Five big shows in Sonarr, all in Plex's "TV Shows" (one also in 4K), none
// watched for at least five years unless a test says otherwise.
function watchStock() {
  allSeries = [
    series(1, "Old Favourite", 101, 300),
    series(2, "Never Started", 102, 200),
    series(3, "Recent Hit", 103, 150),
    series(4, "Forgotten", 104, 100),
    series(5, "Both Libraries", 105, 80),
  ];
  library["3"] = [
    plexShow("11", "Old Favourite", 101, yearsAgo(6), yearsAgo(9)),
    plexShow("12", "Never Started", 102, null, yearsAgo(7)),
    plexShow("13", "Recent Hit", 103, yearsAgo(0.5), yearsAgo(8)),
    plexShow("14", "Forgotten", 104, yearsAgo(5), yearsAgo(8)),
    plexShow("15", "Both Libraries", 105, yearsAgo(7), yearsAgo(8)),
  ];
  library["4"] = [plexShow("25", "Both Libraries", 105, yearsAgo(4), yearsAgo(5))];
}

describe("find_series_by_size: the biggest shows", () => {
  it("B1: without Sonarr it gives the same error as the other Sonarr tools, and asks nothing", async () => {
    setSetting("SONARR_URL", "");
    const result = await run();
    assert.equal(result.isError, true);
    assert.equal(text(result), NOT_CONFIGURED);
    assert.equal(allCalls().length, 0);
  });

  it("B2: one GET /api/v3/series, and no request to Plex or Tautulli", async () => {
    sizeStock();
    useTautulli();
    await run();
    assert.deepEqual(
      sonarr.calls.map((c) => `${c.method} ${c.url}`),
      ["get /api/v3/series"],
    );
    assert.equal(plex.calls.length, 0);
    assert.equal(tautulli.calls.length, 0);
  });

  it("B2: shows with files are ranked largest first, then by title, with size, files, status and monitoring", async () => {
    sizeStock();
    const result = await run();
    assert.equal(result.isError, undefined);
    assert.deepEqual(titles(result), ["Huge", "Middle A", "Middle B", "Small"]);
    assert.match(text(result), /4 shows have files, 505\.0 GB in all\./);
    assert.doesNotMatch(text(result), /Nothing Yet/);
    assert.doesNotMatch(text(result), /Matching \(/);
    assert.equal(
      lines(result)[0],
      "- Huge (2010) - 400.0 GB - 800 episode files - continuing - monitored",
    );
    assert.equal(
      lines(result)[3],
      "- Small (2010) - 5.0 GB - 10 episode files - ended - not monitored",
    );
  });

  it("B2: when more match than limit, the reply says how many are not listed", async () => {
    sizeStock();
    const result = await run({ limit: 3 });
    assert.deepEqual(titles(result), ["Huge", "Middle A", "Middle B"]);
    assert.match(text(result), /Listed the 3 largest; 1 more are not listed/);
    assert.doesNotMatch(text(await run()), /not listed/);
  });

  it("B2: a size is counted in decimal units, as it is printed (1 TB is 10^12 bytes)", async () => {
    allSeries = [series(1, "Enormous", 101, 1500)];
    assert.match(lines(await run())[0]!, /- 1\.5 TB - /);
  });

  it("B3: status, monitored, folder and minSizeGb narrow the list, and the reply totals what matches", async () => {
    sizeStock();
    const byStatus = await run({ status: "continuing" });
    assert.deepEqual(titles(byStatus), ["Huge"]);
    assert.match(text(byStatus), /Matching \(continuing\): 1 show, 400\.0 GB\./);

    assert.deepEqual(titles(await run({ monitored: "monitored" })), ["Huge", "Middle A"]);
    assert.deepEqual(titles(await run({ monitored: "unmonitored" })), ["Middle B", "Small"]);
    assert.deepEqual(titles(await run({ monitored: "any" })).length, 4);

    // folder is text the Sonarr path contains, case-insensitive, as in find_series_by_quality.
    assert.deepEqual(titles(await run({ folder: " TVShowsKids " })), ["Middle B"]);

    const big = await run({ minSizeGb: 50 });
    assert.deepEqual(titles(big), ["Huge", "Middle A", "Middle B"]);
    assert.match(text(big), /Matching \(at least 50 GB\): 3 shows, 500\.0 GB\./);

    const none = await run({ status: "upcoming" });
    assert.equal(none.isError, undefined);
    assert.match(text(none), /Matching \(upcoming\): 0 shows/);
    assert.equal(rows(none).length, 0);
  });

  it("B3: minSizeGb and notWatchedInYears must be above 0, and limit is kept between 1 and 200", async () => {
    sizeStock();
    for (const options of [{ minSizeGb: 0 }, { minSizeGb: -1 }, { notWatchedInYears: 0 }]) {
      const result = await run(options);
      assert.equal(result.isError, true, JSON.stringify(options));
      assert.match(text(result), /must be greater than 0/);
    }
    assert.equal(rows(await run({ limit: 0 })).length, 1);
    assert.equal(rows(await run({ limit: 5000 })).length, 4);
  });

  it("B2: Sonarr failing is an error reply, not an empty list", async () => {
    sonarr.restore();
    sonarr = fakeApi(sonarrClient, () => ({
      status: 500,
      data: { message: "database is locked" },
    }));
    const result = await run();
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to check Sonarr: database is locked/);
  });

  it("B10: the rows are attached as structuredContent (media, append false)", async () => {
    sizeStock();
    const result: any = await run({ limit: 1 });
    assert.equal(result.structuredContent.append, false);
    assert.deepEqual(result.structuredContent.media, [
      {
        kind: "show",
        title: "Huge",
        year: 2010,
        posterUrl: null,
        libraries: null,
        genres: [],
        rating: null,
        detail: "400.0 GB - 800 episode files - continuing - monitored",
      },
    ]);
  });
});

describe("find_series_by_size: big shows nobody has watched (Plex)", () => {
  it("B4: without Plex the watch part is an error that says it needs Plex, and nothing is asked", async () => {
    watchStock();
    setSetting("PLEX_URL", "");
    const result = await run({ notWatchedInYears: 3 });
    assert.equal(result.isError, true);
    assert.match(text(result), /needs Plex/);
    assert.equal(allCalls().length, 0);
    // The size report itself does not need Plex.
    assert.equal((await run()).isError, undefined);
  });

  it("B4: every Plex show library is read, also one the 'libraries to skip' setting leaves out of searches", async () => {
    watchStock();
    setSetting("PLEX_SKIP_LIBRARIES", "4k TV Shows");
    const result = await run({ notWatchedInYears: 3 });
    const read = plex.calls.filter((c) => /\/all$/.test(c.url)).map((c) => c.url);
    assert.deepEqual(read.sort(), ["/library/sections/3/all", "/library/sections/4/all"]);
    assert.ok(
      plex.calls.every((c) => !/sections\/1\//.test(c.url)),
      "movie libraries are not read",
    );
    // The skipped library's copy counts: it was watched 4 years ago, the other copy 7.
    assert.match(
      lines(result).find((l) => l.includes("Both Libraries"))!,
      new RegExp(day(yearsAgo(4))),
    );
  });

  it("B4: shows are matched to Sonarr by TVDB id, or by title and year when Plex has none", async () => {
    allSeries = [series(1, "Renamed In Sonarr", 101, 300), series(2, "No Guid Show", 102, 200)];
    library["3"] = [
      plexShow("11", "Plex Calls It This", 101, yearsAgo(6), yearsAgo(9)),
      plexShow("12", "No Guid Show", null, yearsAgo(6), yearsAgo(9)),
    ];
    const result = await run({ notWatchedInYears: 3 });
    assert.deepEqual(titles(result), ["Renamed In Sonarr", "No Guid Show"]);
  });

  it("B4: the last activity is the latest lastViewedAt over the copies; never watched counts from the earliest addedAt", async () => {
    watchStock();
    // Both copies never watched: added 8 years ago to one library, 1 year ago to the other.
    library["3"]![4] = plexShow("15", "Both Libraries", 105, null, yearsAgo(8));
    library["4"] = [plexShow("25", "Both Libraries", 105, null, yearsAgo(1))];
    const result = await run({ notWatchedInYears: 3 });
    const line = lines(result).find((l) => l.includes("Both Libraries"))!;
    assert.match(line, new RegExp(`never watched, added ${day(yearsAgo(8))}`));

    // One copy watched 7 years ago, the other 2 years ago: watched too recently to list.
    library["3"]![4] = plexShow("15", "Both Libraries", 105, yearsAgo(7), yearsAgo(8));
    library["4"] = [plexShow("25", "Both Libraries", 105, yearsAgo(2), yearsAgo(5))];
    assert.ok(!titles(await run({ notWatchedInYears: 3 })).includes("Both Libraries"));
  });

  it("B4, B8: a show watched with no date anywhere can't be judged: left out and counted", async () => {
    watchStock();
    library["3"]![3] = plexShow("14", "Forgotten", 104, "undated", yearsAgo(8));
    const result = await run({ notWatchedInYears: 3 });
    assert.ok(!titles(result).includes("Forgotten"));
    assert.match(text(result), /1 show has been watched but with no date recorded/);
  });

  it("B8: kept are the shows whose last activity is older than N years, largest first; shows not in Plex are left out and counted", async () => {
    watchStock();
    allSeries.push(series(6, "Only In Sonarr", 106, 500));
    const result = await run({ notWatchedInYears: 3 });
    assert.equal(result.isError, undefined);
    // Recent Hit was watched six months ago; Both Libraries 4 years ago (its 4K copy).
    assert.deepEqual(titles(result), [
      "Old Favourite",
      "Never Started",
      "Forgotten",
      "Both Libraries",
    ]);
    assert.match(text(result), /Not watched in 3 years: 4 shows, 680\.0 GB\./);
    assert.match(text(result), /1 show Sonarr has was not found in Plex and left out\./);
    assert.doesNotMatch(text(result), /Only In Sonarr/);

    // A longer period keeps fewer.
    assert.deepEqual(titles(await run({ notWatchedInYears: 5.5 })), [
      "Old Favourite",
      "Never Started",
    ]);
  });

  it("B8: each line and row detail carries the watch date, and the row's lastWatched and added are set", async () => {
    watchStock();
    const result = await run({ notWatchedInYears: 3 });
    const watched = day(yearsAgo(6));
    const added = day(yearsAgo(7));
    assert.equal(
      lines(result)[0],
      `- Old Favourite (2010) - 300.0 GB - 600 episode files - ended - not monitored - last watched ${watched}`,
    );
    assert.equal(
      lines(result)[1],
      `- Never Started (2010) - 200.0 GB - 400 episode files - ended - not monitored - never watched, added ${added}`,
    );
    const [first, second] = rows(result);
    assert.match(first.detail, new RegExp(`last watched ${watched}$`));
    assert.equal(first.lastWatched, watched);
    assert.equal(first.added, day(yearsAgo(9)));
    assert.deepEqual(first.libraries, ["TV Shows"]);
    assert.match(second.detail, new RegExp(`never watched, added ${added}$`));
    assert.equal(second.lastWatched, null);
    assert.equal(second.added, added);
    assert.deepEqual(rows(result)[3].libraries, ["TV Shows", "4k TV Shows"]);
  });

  it("B3, B8: the Sonarr filters and limit apply to the watch list too", async () => {
    watchStock();
    const result = await run({ notWatchedInYears: 3, minSizeGb: 150, limit: 1 });
    assert.deepEqual(titles(result), ["Old Favourite"]);
    assert.match(text(result), /Matching \(at least 150 GB\): 3 shows/);
    assert.match(text(result), /Listed the 1 largest; 1 more are not listed/);
  });

  it("B7: with no Tautulli the reply says the watch data is the one Plex account, and Tautulli is not asked", async () => {
    watchStock();
    const result = await run({ notWatchedInYears: 3 });
    assert.match(text(result), /only the one Plex account the app is connected with/);
    assert.doesNotMatch(text(result), /Plex account only/);
    assert.doesNotMatch(text(result), /every user|all users|everyone|nobody/i);
    assert.equal(tautulli.calls.length, 0);
  });

  it("B4: Plex failing is an error reply that says Plex could not be read, never an empty list", async () => {
    watchStock();
    plexReply = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const result = await run({ notWatchedInYears: 3 });
    assert.equal(result.isError, true);
    assert.match(text(result), /Plex could not be read.*ECONNREFUSED/);
    assert.equal(rows(result).length, 0);
  });

  it("B10: the watch list is attached as structuredContent (media, append false) too", async () => {
    watchStock();
    const result: any = await run({ notWatchedInYears: 3 });
    assert.equal(result.structuredContent.append, false);
    assert.equal(result.structuredContent.media.length, 4);
  });
});

describe("find_series_by_size: big shows nobody has watched (Plex and Tautulli)", () => {
  beforeEach(() => {
    watchStock();
    useTautulli();
  });

  it("B5: Tautulli is asked once per show library, for the whole library, without a refresh, with up to 30 seconds", async () => {
    await run({ notWatchedInYears: 3 });
    assert.equal(tautulli.calls.length, 2);
    assert.deepEqual(tautulli.calls.map((c) => String(c.params.section_id)).sort(), ["3", "4"]);
    for (const call of tautulli.calls) {
      assert.equal(call.method, "get");
      assert.equal(call.params.cmd, "get_library_media_info");
      assert.ok(Number(call.params.length) >= 5, "length covers the whole library");
      assert.ok(!("refresh" in call.params), "Tautulli is never asked to rebuild its list");
      assert.equal(call.limits.timeout, 30_000);
    }
  });

  it("B5: a library larger than the usual page is still asked for in one page", async () => {
    library["3"] = Array.from({ length: 5200 }, (_, i) =>
      plexShow(String(1000 + i), `Filler ${i}`, 9000 + i, yearsAgo(1), yearsAgo(2)),
    );
    library["3"].push(plexShow("11", "Old Favourite", 101, yearsAgo(6), yearsAgo(9)));
    await run({ notWatchedInYears: 3 });
    const call = tautulli.calls.find((c) => String(c.params.section_id) === "3")!;
    assert.equal(call.params.length, 5201);
  });

  it("B6: Tautulli is consulted only for the candidates: with none, it is not asked at all", async () => {
    const result = await run({ notWatchedInYears: 20 });
    assert.equal(rows(result).length, 0);
    assert.equal(tautulli.calls.length, 0);
  });

  it("B5, B6: rows are matched by rating_key; a row with recent plays takes the show off the list", async () => {
    tautulliLibrary["3"] = tautulliOk([
      row("11", 4, yearsAgo(1)),
      // Another show's rating key: must not be read as Never Started's.
      row("999", 9, yearsAgo(0.1)),
    ]);
    const result = await run({ notWatchedInYears: 3 });
    assert.deepEqual(titles(result), ["Never Started", "Forgotten", "Both Libraries"]);
    assert.match(text(result), /Tautulli's history took 1 show off the list/);
  });

  it("B6: a row with old plays keeps the show and corrects its date to the later of Plex's and Tautulli's", async () => {
    tautulliLibrary["3"] = tautulliOk([
      // Plex: watched 6 years ago. Tautulli: someone played it 4 years ago.
      row("11", 2, yearsAgo(4)),
      // Plex: never watched. Tautulli: played 5 years ago.
      row("12", 1, yearsAgo(5)),
      // Plex: watched 5 years ago. Tautulli's last play is older: Plex's date stays.
      row("14", 1, yearsAgo(9)),
    ]);
    const result = await run({ notWatchedInYears: 3 });
    assert.deepEqual(titles(result), [
      "Old Favourite",
      "Never Started",
      "Forgotten",
      "Both Libraries",
    ]);
    assert.match(lines(result)[0]!, new RegExp(`last watched ${day(yearsAgo(4))}$`));
    assert.match(lines(result)[1]!, new RegExp(`last watched ${day(yearsAgo(5))}$`));
    assert.equal(rows(result)[1].lastWatched, day(yearsAgo(5)));
    assert.match(lines(result)[2]!, new RegExp(`last watched ${day(yearsAgo(5))}$`));
    for (const line of lines(result).slice(0, 3)) assert.doesNotMatch(line, /Plex account only/);
  });

  it("B6, B7: a row with no plays and a show with no row add nothing: judged from Plex alone, marked and counted", async () => {
    tautulliLibrary["3"] = tautulliOk([
      row("11", 3, yearsAgo(5)),
      // No plays, in the forms Tautulli may send: 0, null, a missing count.
      row("12", 0),
      row("14", null),
      // "15" (Both Libraries) has no row at all in this library.
    ]);
    tautulliLibrary["4"] = tautulliOk([{ rating_key: "25" }]);
    const result = await run({ notWatchedInYears: 3 });
    // Nothing is read as "zero plays, so nobody watched": the list is what Plex alone gives.
    assert.deepEqual(titles(result), [
      "Old Favourite",
      "Never Started",
      "Forgotten",
      "Both Libraries",
    ]);
    assert.doesNotMatch(lines(result)[0]!, /Plex account only/);
    for (const line of lines(result).slice(1)) assert.match(line, /\(Plex account only\)$/);
    assert.match(
      text(result),
      /3 listed shows were judged from the Plex account alone because Tautulli had no row or no plays for them/,
    );
    assert.match(rows(result)[1].detail, /never watched, added .* \(Plex account only\)$/);
  });

  it("B5, B7: a failed Tautulli call is named as failed, and the shows there are judged from Plex alone", async () => {
    tautulliLibrary["3"] = () => {
      throw new Error("timeout of 30000ms exceeded");
    };
    tautulliLibrary["4"] = { status: 500, data: {} };
    const result = await run({ notWatchedInYears: 3 });
    assert.equal(result.isError, undefined);
    assert.deepEqual(titles(result), [
      "Old Favourite",
      "Never Started",
      "Forgotten",
      "Both Libraries",
    ]);
    assert.match(
      text(result),
      /Tautulli's answer for the library "TV Shows" could not be used: the call failed \(timeout of 30000ms exceeded\)/,
    );
    assert.match(text(result), /library "4k TV Shows" could not be used: the call failed/);
    for (const line of lines(result)) assert.match(line, /\(Plex account only\)$/);
  });

  it("B5, B7: an envelope that isn't 'success' is not used, even if it carries rows", async () => {
    tautulliLibrary["3"] = {
      data: {
        response: {
          result: "error",
          message: "Invalid apikey",
          data: { recordsTotal: 1, data: [row("11", 5, yearsAgo(0.1))] },
        },
      },
    };
    const result = await run({ notWatchedInYears: 3 });
    assert.ok(titles(result).includes("Old Favourite"), "the row of a failed answer is ignored");
    assert.match(text(result), /library "TV Shows" could not be used: the call failed/);
    // Tautulli's own message is not passed on.
    assert.doesNotMatch(text(result), /apikey/i);
  });

  it("B5, B7: an answer with fewer rows than it says the library has is incomplete and not used", async () => {
    tautulliLibrary["3"] = tautulliOk([row("11", 5, yearsAgo(0.1))], 250);
    const result = await run({ notWatchedInYears: 3 });
    assert.ok(
      titles(result).includes("Old Favourite"),
      "the row of an incomplete answer is ignored",
    );
    assert.match(
      text(result),
      /library "TV Shows" could not be used: the answer was incomplete \(1 of 250 rows\)/,
    );
    assert.match(lines(result)[0]!, /\(Plex account only\)$/);

    // No list of rows at all is incomplete too.
    tautulliLibrary["3"] = { data: { response: { result: "success", data: {} } } };
    assert.match(text(await run({ notWatchedInYears: 3 })), /the answer was incomplete/);
  });

  it("B6: one library's answer is usable and another's is not", async () => {
    // "TV Shows" fails; "4k TV Shows" answers, with a recent play of Both Libraries.
    tautulliLibrary["3"] = { status: 502 };
    tautulliLibrary["4"] = tautulliOk([row("25", 6, yearsAgo(0.2))]);
    const result = await run({ notWatchedInYears: 3 });
    assert.deepEqual(titles(result), ["Old Favourite", "Never Started", "Forgotten"]);
    assert.match(text(result), /library "TV Shows" could not be used/);
    assert.doesNotMatch(text(result), /library "4k TV Shows" could not be used/);
    assert.match(text(result), /Tautulli's history took 1 show off the list/);
    for (const line of lines(result)) assert.match(line, /\(Plex account only\)$/);
  });

  it("B6: a show Plex could not judge stays left out, even with an old play in Tautulli", async () => {
    library["3"]![3] = plexShow("14", "Forgotten", 104, "undated", yearsAgo(8));
    tautulliLibrary["3"] = tautulliOk([row("14", 1, yearsAgo(6))]);
    const result = await run({ notWatchedInYears: 3 });
    assert.ok(!titles(result).includes("Forgotten"));
    assert.match(text(result), /1 show has been watched but with no date recorded/);
  });

  it("B6: plays in Tautulli with no date, for a show Plex says was never watched, can't be judged", async () => {
    tautulliLibrary["3"] = tautulliOk([row("12", 2, null)]);
    const result = await run({ notWatchedInYears: 3 });
    assert.ok(!titles(result).includes("Never Started"));
    assert.match(text(result), /1 show has been watched but with no date recorded/);
  });

  it("B6: on the same data, the list with Tautulli is a subset of the list without it", async () => {
    const tautulliAnswers: Array<Record<string, FakeReply | (() => FakeReply)>> = [
      {},
      { "3": tautulliOk([row("11", 1, yearsAgo(0.5)), row("12", 0), row("14", 3, yearsAgo(4))]) },
      {
        "3": tautulliOk([row("12", 7, yearsAgo(1))]),
        "4": tautulliOk([row("25", 1, yearsAgo(1))]),
      },
      { "3": { status: 500 }, "4": tautulliOk([], 40) },
      { "3": tautulliOk([row("11", 2, null), row("12", 2, null), row("15", 1, yearsAgo(30))]) },
    ];
    for (const years of [1, 3, 4.5, 6]) {
      setSetting("TAUTULLI_URL", "");
      const without = titles(await run({ notWatchedInYears: years }));
      useTautulli();
      for (const answers of tautulliAnswers) {
        tautulliLibrary = answers;
        const withIt = titles(await run({ notWatchedInYears: years }));
        assert.deepEqual(
          withIt.filter((t) => !without.includes(t)),
          [],
          `Tautulli put a show on the ${years}-year list`,
        );
        // And the order is still the one without it: largest first.
        assert.deepEqual(
          withIt,
          without.filter((t) => withIt.includes(t)),
        );
      }
    }
  });

  it("B7: with Tautulli the reply says what the watch data is, and never claims to know every user", async () => {
    tautulliLibrary["3"] = tautulliOk([row("11", 3, yearsAgo(5))]);
    const result = await run({ notWatchedInYears: 3 });
    assert.match(
      text(result),
      /the Plex account the app is connected with, plus the plays in Tautulli's history/,
    );
    assert.match(text(result), /starts when Tautulli was installed/);
    assert.match(text(result), /may leave out users archived there/);
    assert.doesNotMatch(text(result), /every user|all users|everyone|nobody/i);
  });

  it("B9: every request the tool sends, to Sonarr, Plex and Tautulli, is a GET", async () => {
    tautulliLibrary["3"] = tautulliOk([row("11", 3, yearsAgo(5))]);
    await run();
    await run({ status: "ended", folder: "tv", minSizeGb: 1 });
    await run({ notWatchedInYears: 3 });
    assert.ok(sonarr.calls.length > 0 && plex.calls.length > 0 && tautulli.calls.length > 0);
    for (const call of allCalls()) assert.equal(call.method, "get", `${call.method} ${call.url}`);
  });
});

describe("find_series_by_size: the tool", () => {
  const tool = () => movieTools.find((t) => t.name === "find_series_by_size")!;

  it("B9: it is defined once, for MCP clients and the Query chat, and says it reports and deletes nothing", () => {
    assert.equal(movieTools.filter((t) => t.name === "find_series_by_size").length, 1);
    assert.match(tool().description, /only reports: it deletes nothing and changes nothing/);
    assert.match(tool().description, /Read-only/);
    assert.doesNotMatch(tool().description, /every user|all users/i);
  });

  it("B2, B3: both schemas take the six optional arguments and refuse values outside them", async () => {
    const names = ["notWatchedInYears", "status", "monitored", "folder", "minSizeGb", "limit"];
    assert.deepEqual(Object.keys(tool().zodSchema), names);
    assert.deepEqual(Object.keys(tool().inputSchema.properties), names);
    assert.deepEqual(tool().inputSchema.required, []);
    const properties = tool().inputSchema.properties as Record<string, { enum?: string[] }>;
    assert.deepEqual(properties.status!.enum, ["continuing", "ended", "upcoming"]);
    assert.deepEqual(properties.monitored!.enum, ["any", "monitored", "unmonitored"]);

    sizeStock();
    for (const bad of [
      { status: "deleted" },
      { monitored: "yes" },
      { minSizeGb: 0 },
      { notWatchedInYears: -2 },
      { limit: 201 },
      { limit: 0 },
    ]) {
      const result = await tool().handler(bad);
      assert.equal(result.isError, true, JSON.stringify(bad));
      assert.match((result.content[0] as { text: string }).text, /Invalid arguments/);
    }
    assert.equal(sonarr.calls.length, 0);
    const ok = await tool().handler({ status: "ended", limit: 200 });
    assert.equal(ok.isError, undefined);
  });
});
