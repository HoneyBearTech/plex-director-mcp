import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plexClient, sonarrClient } from "../src/clients.js";
import { searchPlexLibrary } from "../src/tools/plex.js";
import { movieTools } from "../src/tools/movies.js";
import { indexSonarrSeries, matchShowToSonarr, tvdbIdsOf } from "../src/tools/showMatch.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb, type FakeReply, type RecordedRequest } from "./helpers.js";

// The showStatus (S1-S8) and director (D1-D5) filters of search_plex_library.
// Plex and Sonarr are the suite's fakes; nothing here reaches a real service.

const SECTIONS = [
  { key: "1", type: "movie", title: "Movies" },
  { key: "2", type: "movie", title: "4k Movies" },
  { key: "3", type: "show", title: "TV Shows" },
  { key: "4", type: "show", title: "4k TV Shows" },
];

const movie = (title: string, year: number, extra: Record<string, unknown> = {}) => ({
  title,
  titleSort: title,
  year,
  Genre: [{ tag: "Thriller" }],
  Guid: [{ id: `tmdb://${year}${title.length}` }],
  ...extra,
});

// tvdb: the show's TVDB id, or null for a show Plex has no TVDB id for.
const show = (
  title: string,
  year: number,
  tvdb: number | null,
  extra: Record<string, unknown> = {},
) => ({
  title,
  titleSort: title,
  year,
  childCount: 3,
  leafCount: 30,
  viewedLeafCount: 0,
  Genre: [{ tag: "Drama" }],
  Guid: tvdb === null ? [] : [{ id: `tmdb://${tvdb + 50000}` }, { id: `tvdb://${tvdb}` }],
  ...extra,
});

const series = (id: number, title: string, year: number, tvdbId: number, status: string) => ({
  id,
  title,
  year,
  tvdbId,
  status,
});

let plex: ReturnType<typeof fakeApi>;
let sonarr: ReturnType<typeof fakeApi>;
let library: Record<string, any[]>;
let hubs: Array<{ type: string; Directory?: Array<{ id: number; tag: string }> }>;
let allSeries: any[];
let sonarrReply: ((req: RecordedRequest) => FakeReply) | null;

beforeEach(async () => {
  await resetDb();
  setSetting("PLEX_URL", "http://plex:32400");
  setSetting("SONARR_URL", "http://sonarr:8989");
  library = { "1": [], "2": [], "3": [], "4": [] };
  hubs = [];
  allSeries = [];
  sonarrReply = null;
  plex = fakeApi(plexClient, (req) => {
    if (req.url === "/library/sections")
      return { data: { MediaContainer: { Directory: SECTIONS } } };
    if (req.url === "/hubs/search") return { data: { MediaContainer: { Hub: hubs } } };
    const m = req.url.match(/^\/library\/sections\/(\d+)\/all$/);
    if (m) {
      // Like Plex, a tag filter narrows the list: items carry the ids they match.
      const wanted = req.params.director;
      const items = (library[m[1]!] ?? []).filter(
        (item) => wanted === undefined || String(item.directorId) === String(wanted),
      );
      return { data: { MediaContainer: { totalSize: items.length, Metadata: items } } };
    }
    return { status: 404 };
  });
  sonarr = fakeApi(sonarrClient, (req) => {
    if (sonarrReply) return sonarrReply(req);
    if (req.url === "/api/v3/series") return { data: allSeries };
    return { status: 404 };
  });
});
afterEach(() => {
  plex?.restore();
  sonarr?.restore();
});

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => (r.structuredContent?.media ?? []) as any[];
const titles = (r: any) => rows(r).map((m) => m.title);
const lines = (r: any) =>
  text(r)
    .split("\n")
    .filter((l) => l.startsWith("- "));
const sectionCalls = () => plex.calls.filter((c) => /\/all$/.test(c.url));
const searchedSections = () => sectionCalls().map((c) => c.url.match(/sections\/(\d+)\//)![1]);

function stockShows() {
  library["3"] = [
    show("Alpha", 2010, 101),
    show("Bravo", 2012, 102),
    show("Charlie", 2014, 103),
    show("Delta", 2016, 104),
    show("Echo", 2018, 105),
  ];
  library["1"] = [movie("A Movie", 2001)];
  allSeries = [
    series(1, "Alpha", 2010, 101, "continuing"),
    series(2, "Bravo", 2012, 102, "ended"),
    series(3, "Charlie", 2014, 103, "continuing"),
    series(4, "Delta", 2016, 104, "upcoming"),
    series(5, "Echo", 2018, 105, "continuing"),
  ];
}

describe("search_plex_library: showStatus (from Sonarr)", () => {
  it("S1: without Sonarr it says show status comes from Sonarr, and Plex is not queried", async () => {
    setSetting("SONARR_URL", "");
    stockShows();
    const result = await searchPlexLibrary({ showStatus: "ended" });
    assert.equal(result.isError, true);
    assert.match(text(result), /Show status .* comes from Sonarr, and Sonarr isn't set up/);
    assert.equal(plex.calls.length, 0, "Plex is not queried");
    assert.equal(sonarr.calls.length, 0);
  });

  it("S2: with mediaType 'movie' it is an error, and nothing is queried", async () => {
    stockShows();
    const result = await searchPlexLibrary({ showStatus: "ended", mediaType: "movie" });
    assert.equal(result.isError, true);
    assert.match(text(result), /showStatus is for TV shows/);
    assert.equal(plex.calls.length, 0);
    assert.equal(sonarr.calls.length, 0);
  });

  it("S2: with mediaType 'any' or none, only show libraries are searched", async () => {
    stockShows();
    for (const mediaType of [undefined, "any", "show"] as const) {
      plex.calls.length = 0;
      const result = await searchPlexLibrary({
        showStatus: "continuing",
        ...(mediaType ? { mediaType } : {}),
      });
      assert.notEqual(result.isError, true);
      assert.deepEqual(searchedSections().sort(), ["3", "4"], `mediaType ${mediaType}`);
      assert.ok(rows(result).every((r) => r.kind === "show"));
    }
  });

  it("S3: the status comes from one GET /api/v3/series", async () => {
    stockShows();
    await searchPlexLibrary({ showStatus: "continuing" });
    assert.equal(sonarr.calls.length, 1);
    assert.equal(sonarr.calls[0]!.method, "get");
    assert.equal(sonarr.calls[0]!.url, "/api/v3/series");
  });

  it("S3: a show is matched by TVDB id, whatever its title, from any library copy", async () => {
    // Plex and Sonarr title the show differently; the TVDB id is only on the
    // 4K copy (the HD copy is unmatched in Plex, but is the same show by title).
    library["3"] = [show("The Office", 2005, null, { Guid: [{ id: "tmdb://2316" }] })];
    library["4"] = [
      show("The Office", 2005, null, { Guid: [{ id: "tmdb://2316" }, { id: "tvdb://73244" }] }),
    ];
    allSeries = [series(9, "The Office (US)", 2005, 73244, "ended")];
    const result = await searchPlexLibrary({ showStatus: "ended" });
    assert.deepEqual(titles(result), ["The Office"]);
    assert.deepEqual(rows(result)[0].libraries, ["TV Shows", "4k TV Shows"]);
  });

  it("S3: a show with no TVDB id in Plex is matched by folded title plus year", async () => {
    library["3"] = [
      show("Amélie & Friends", 2019, null),
      // Same title, another year: not the same show.
      show("Amelie and Friends", 2001, null),
    ];
    allSeries = [series(1, "Amelie and Friends", 2019, 555, "ended")];
    const result = await searchPlexLibrary({ showStatus: "ended" });
    assert.deepEqual(titles(result), ["Amélie & Friends"]);
    assert.match(text(result), /1 show that matched the other filters is not in Sonarr/);
  });

  it("S3: a show with a TVDB id is not matched by title when Sonarr has another id for that title", async () => {
    library["3"] = [show("Kingdom", 2019, 111)];
    allSeries = [series(1, "Kingdom", 2019, 222, "ended")];
    const result = await searchPlexLibrary({ showStatus: "ended" });
    assert.deepEqual(titles(result), []);
    assert.match(text(result), /1 show that matched the other filters is not in Sonarr/);
  });

  it("S3: the matching is exported from showMatch for other tools", () => {
    const index = indexSonarrSeries([
      series(1, "Alpha", 2010, 101, "ended"),
      series(2, "Twin", 2000, 0, "ended"),
      series(3, "Twin", 2000, 0, "continuing"),
    ] as any);
    assert.deepEqual(tvdbIdsOf([show("x", 1, 7), show("x", 1, 8), show("x", 1, 7)]), [7, 8]);
    assert.equal(matchShowToSonarr([show("Anything", 1999, 101)], index)?.id, 1);
    assert.equal(matchShowToSonarr([show("ALPHA", 2010, null)], index)?.id, 1);
    assert.equal(matchShowToSonarr([show("Alpha", 2011, null)], index), null);
    assert.equal(matchShowToSonarr([show("Alpha", 2010, 999)], index), null);
    // Two Sonarr series share the title and year: not guessed.
    assert.equal(matchShowToSonarr([show("Twin", 2000, null)], index), null);
  });

  it("S4: only shows with that status are returned; shows Sonarr doesn't have are left out and counted", async () => {
    stockShows();
    library["3"]!.push(show("Not In Sonarr", 2020, 900), show("Also Missing", 2021, 901));
    const continuing = await searchPlexLibrary({ showStatus: "continuing" });
    assert.deepEqual(titles(continuing), ["Alpha", "Charlie", "Echo"]);
    assert.match(
      text(continuing),
      /2 shows that matched the other filters are not in Sonarr, so their status is unknown and they were left out\./,
    );
    assert.deepEqual(titles(await searchPlexLibrary({ showStatus: "ended" })), ["Bravo"]);
    assert.deepEqual(titles(await searchPlexLibrary({ showStatus: "upcoming" })), ["Delta"]);
  });

  it("S4: the count is of shows that passed the other filters, and is absent when there are none", async () => {
    stockShows();
    library["3"]!.push(
      show("Not In Sonarr", 2020, 900),
      show("Unwatched Stranger", 2021, 901, { year: 1990 }),
    );
    const narrowed = await searchPlexLibrary({ showStatus: "continuing", yearFrom: 2015 });
    assert.deepEqual(titles(narrowed), ["Echo"]);
    assert.match(text(narrowed), /1 show that matched the other filters is not in Sonarr/);

    library["3"] = library["3"]!.slice(0, 5);
    const all = await searchPlexLibrary({ showStatus: "continuing" });
    assert.doesNotMatch(text(all), /not in Sonarr/);
  });

  it("S4: when nothing has the status, the reply still says how many shows Sonarr doesn't have", async () => {
    library["3"] = [show("Alpha", 2010, 101), show("Stranger", 2011, 900)];
    allSeries = [series(1, "Alpha", 2010, 101, "continuing")];
    const result = await searchPlexLibrary({ showStatus: "ended" });
    assert.notEqual(result.isError, true);
    assert.match(text(result), /No shows in Plex match show status "ended" in Sonarr\./);
    assert.match(text(result), /1 show that matched the other filters is not in Sonarr/);
  });

  it("S5: the filter runs before sorting and paging: total, limit and offset count the filtered set", async () => {
    stockShows();
    const first = await searchPlexLibrary({ showStatus: "continuing", limit: 2 });
    assert.deepEqual(titles(first), ["Alpha", "Charlie"]);
    assert.match(text(first), /3 matching shows, listed 1-2\./);
    assert.match(text(first), /1 more are not listed: call again with offset 2/);
    const second = await searchPlexLibrary({ showStatus: "continuing", limit: 2, offset: 2 });
    assert.deepEqual(titles(second), ["Echo"]);
    assert.match(text(second), /3 matching shows, listed 3-3\./);
    const past = await searchPlexLibrary({ showStatus: "continuing", offset: 3 });
    assert.match(text(past), /Offset 3 is past the end: there are only 3 matching shows/);
  });

  it("S6: each listed show's line and its row's detail carry the status", async () => {
    stockShows();
    const result = await searchPlexLibrary({ showStatus: "upcoming" });
    assert.equal(lines(result).length, 1);
    assert.match(lines(result)[0]!, /^- Delta \(2016\) - TV show, .* - Sonarr status: upcoming$/);
    assert.equal(rows(result)[0].detail, "Sonarr status: upcoming");
    // Without the filter nothing is said about status, and Sonarr isn't asked.
    sonarr.calls.length = 0;
    const plain = await searchPlexLibrary({ mediaType: "show" });
    assert.equal(rows(plain)[0].detail, null);
    assert.doesNotMatch(text(plain), /Sonarr/);
    assert.equal(sonarr.calls.length, 0);
  });

  it("S7: Sonarr answering with an error is 'could not be read', never 'no shows match'", async () => {
    stockShows();
    sonarrReply = () => ({ status: 500, data: { message: "database is locked" } });
    const result = await searchPlexLibrary({ showStatus: "ended" });
    assert.equal(result.isError, true);
    assert.match(text(result), /Sonarr could not be read/);
    assert.match(text(result), /database is locked/);
    assert.doesNotMatch(text(result), /No shows in Plex match/);
    assert.equal(rows(result).length, 0);
  });

  it("S7: Sonarr unreachable is 'could not be read' too", async () => {
    stockShows();
    sonarrReply = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const result = await searchPlexLibrary({ showStatus: "continuing" });
    assert.equal(result.isError, true);
    assert.match(text(result), /Sonarr could not be read.*ECONNREFUSED/);
    assert.doesNotMatch(text(result), /No shows in Plex match/);
  });

  it("S8: showStatus alone is enough to search, and the 'provide at least one of' message lists it", async () => {
    stockShows();
    const alone = await searchPlexLibrary({ showStatus: "ended" });
    assert.notEqual(alone.isError, true);
    assert.deepEqual(titles(alone), ["Bravo"]);
    const nothing = await searchPlexLibrary({});
    assert.equal(nothing.isError, true);
    assert.match(text(nothing), /Provide at least one of: .*\bshowStatus\b/);
  });

  it("S2, S8: both schemas of the tool accept showStatus, and only its three values", async () => {
    const tool = movieTools.find((t) => t.name === "search_plex_library");
    assert.ok(tool);
    assert.deepEqual((tool.inputSchema.properties.showStatus as { enum: string[] }).enum, [
      "continuing",
      "ended",
      "upcoming",
    ]);
    stockShows();
    assert.deepEqual(titles(await tool.handler({ showStatus: "ended" })), ["Bravo"]);
    const bad = await tool.handler({ showStatus: "deleted" });
    assert.equal(bad.isError, true);
    assert.match(text(bad as any), /Invalid arguments for search_plex_library: .*showStatus/s);
    assert.doesNotMatch(tool.description, /use Sonarr tools for that/);
    assert.match(tool.description, /showStatus/);
    assert.match(tool.description, /director/);
  });
});

describe("search_plex_library: director (movies only)", () => {
  const nolan = { id: 4201, tag: "Christopher Nolan" };
  function stockMovies() {
    library["1"] = [
      movie("Insomnia", 2002, { directorId: 4201 }),
      movie("Memento", 2000, { directorId: 4201, Genre: [{ tag: "Mystery" }] }),
      movie("Heat", 1995, { directorId: 77 }),
    ];
    library["2"] = [movie("Insomnia", 2002, { directorId: 4201 })];
    library["3"] = [show("Some Show", 2010, 101)];
    hubs = [
      { type: "actor", Directory: [{ id: 9, tag: "Christopher Nolan" }] },
      { type: "director", Directory: [nolan, { ...nolan }] },
      { type: "movie" },
    ];
  }

  it("D1: the name is resolved through /hubs/search from the hub of type 'director'", async () => {
    stockMovies();
    const result = await searchPlexLibrary({ director: "christopher nolan" });
    const hubCall = plex.calls.find((c) => c.url === "/hubs/search");
    assert.equal(hubCall?.params.query, "christopher nolan");
    // The director hub's id, not the same-named entry of the actor hub.
    for (const call of sectionCalls()) assert.equal(call.params.director, "4201");
    assert.deepEqual(titles(result), ["Insomnia", "Memento"]);
  });

  it("D1: no match is an error reply", async () => {
    stockMovies();
    hubs = [{ type: "actor", Directory: [{ id: 9, tag: "Zed Nobody" }] }];
    const result = await searchPlexLibrary({ director: "Zed Nobody" });
    assert.equal(result.isError, true);
    assert.match(text(result), /No director matching "Zed Nobody" found in the Plex library/);
    assert.equal(sectionCalls().length, 0);
  });

  it("D1: several people with no single exact match is an error reply listing them", async () => {
    stockMovies();
    hubs = [
      {
        type: "director",
        Directory: [
          { id: 1, tag: "Ridley Scott" },
          { id: 2, tag: "Tony Scott" },
        ],
      },
    ];
    const several = await searchPlexLibrary({ director: "Scott" });
    assert.equal(several.isError, true);
    assert.match(
      text(several),
      /"Scott" matches several directors in Plex: Ridley Scott, Tony Scott\./,
    );
    assert.equal(sectionCalls().length, 0);
    // One exact match among several is used.
    await searchPlexLibrary({ director: "tony scott" });
    for (const call of sectionCalls()) assert.equal(call.params.director, "2");
  });

  it("D2: movie libraries are searched with Plex's director filter set to the resolved id", async () => {
    stockMovies();
    await searchPlexLibrary({ director: "Christopher Nolan", mediaType: "movie" });
    assert.deepEqual(searchedSections().sort(), ["1", "2"]);
    for (const call of sectionCalls()) assert.equal(call.params.director, "4201");
  });

  it("D2: with mediaType 'show' it is an error saying Plex keeps TV directors per episode", async () => {
    stockMovies();
    const result = await searchPlexLibrary({ director: "Christopher Nolan", mediaType: "show" });
    assert.equal(result.isError, true);
    assert.match(text(result), /Plex keeps TV directors per episode/);
    assert.match(text(result), /shows can't be searched by director/);
    assert.equal(plex.calls.length, 0);
  });

  it("D2: with 'any' or no mediaType only movie libraries are searched, and the reply says shows are not", async () => {
    stockMovies();
    for (const mediaType of [undefined, "any"] as const) {
      plex.calls.length = 0;
      const result = await searchPlexLibrary({
        director: "Christopher Nolan",
        ...(mediaType ? { mediaType } : {}),
      });
      assert.deepEqual(searchedSections().sort(), ["1", "2"]);
      assert.ok(rows(result).every((r) => r.kind === "movie"));
      assert.match(text(result), /TV shows are not searched by director/);
    }
    // Also said when nothing matches, and not said when movies were asked for.
    library["1"] = [];
    library["2"] = [];
    const none = await searchPlexLibrary({ director: "Christopher Nolan" });
    assert.match(text(none), /No movies in Plex match director Christopher Nolan\./);
    assert.match(text(none), /TV shows are not searched by director/);
    stockMovies();
    const movies = await searchPlexLibrary({ director: "Christopher Nolan", mediaType: "movie" });
    assert.doesNotMatch(text(movies), /TV shows are not searched/);
  });

  it("D3: director together with showStatus is an error, and nothing is queried", async () => {
    stockMovies();
    const result = await searchPlexLibrary({ director: "Christopher Nolan", showStatus: "ended" });
    assert.equal(result.isError, true);
    assert.match(text(result), /director and showStatus can't be combined/);
    assert.equal(plex.calls.length, 0);
    assert.equal(sonarr.calls.length, 0);
  });

  it("D4: it combines with the other filters as actor does, and the heading names the director", async () => {
    stockMovies();
    const result = await searchPlexLibrary({
      director: "christopher nolan",
      year: 2002,
      library: "4k",
      title: "Insom",
    });
    assert.deepEqual(searchedSections(), ["2"]);
    const [call] = sectionCalls();
    assert.equal(call!.params.director, "4201");
    assert.equal(call!.params.year, 2002);
    assert.equal(call!.params.title, "Insom");
    assert.match(text(result), /^## Plex library: .*director Christopher Nolan/);
    // One title held in two libraries is still one result.
    const both = await searchPlexLibrary({ director: "Christopher Nolan", yearFrom: 2001 });
    assert.deepEqual(titles(both), ["Insomnia"]);
    assert.deepEqual(rows(both)[0].libraries, ["Movies", "4k Movies"]);
  });

  it("D5: director alone is enough to search, and the 'provide at least one of' message lists it", async () => {
    stockMovies();
    const alone = await searchPlexLibrary({ director: "Christopher Nolan" });
    assert.notEqual(alone.isError, true);
    assert.equal(rows(alone).length, 2);
    const nothing = await searchPlexLibrary({ director: "   " });
    assert.equal(nothing.isError, true);
    assert.match(text(nothing), /Provide at least one of: .*\bdirector\b/);
  });

  it("D1, D5: both schemas of the tool accept director", async () => {
    const tool = movieTools.find((t) => t.name === "search_plex_library");
    assert.ok(tool);
    assert.ok("director" in tool.inputSchema.properties);
    stockMovies();
    assert.deepEqual(titles(await tool.handler({ director: "Christopher Nolan" })), [
      "Insomnia",
      "Memento",
    ]);
  });
});
