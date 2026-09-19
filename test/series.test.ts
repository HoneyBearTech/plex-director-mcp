import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sonarrClient } from "../src/clients.js";
import { analyzeEpisodes, checkSeriesCompleteness, episodeRanges, findSeries, findSeriesGaps, seasonRanges } from "../src/tools/series.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb } from "./helpers.js";

const PAST = "2001-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";

interface EpisodeSpec {
  season: number;
  number: number;
  have?: boolean;
  monitored?: boolean;
  airs?: string | null;
}
const episode = ({ season, number, have = false, monitored = true, airs = PAST }: EpisodeSpec) => ({
  seasonNumber: season,
  episodeNumber: number,
  hasFile: have,
  monitored,
  airDateUtc: airs,
});
// A season of `count` episodes where the numbers in `have` are downloaded.
const season = (n: number, count: number, have: number[] | "all" | "none" = "all", extra: Partial<EpisodeSpec> = {}) =>
  Array.from({ length: count }, (_, i) =>
    episode({ season: n, number: i + 1, have: have === "all" ? true : have === "none" ? false : have.includes(i + 1), ...extra })
  );

const series = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  year: 2010,
  status: "ended",
  monitored: false,
  network: "AMC",
  alternateTitles: [],
  statistics: { totalEpisodeCount: 999, episodeFileCount: 0 },
  ...extra,
});

let sonarr: ReturnType<typeof fakeApi>;
let allSeries: any[];
let episodes: Record<number, any[]>;
let inFlight = 0;
let maxInFlight = 0;

function sonarrFake(overrides?: (url: string, params: Record<string, unknown>) => any) {
  sonarr = fakeApi(sonarrClient, async (req) => {
    const custom = overrides?.(req.url, req.params);
    if (custom) return custom;
    if (req.url === "/api/v3/series") return { data: allSeries };
    if (req.url === "/api/v3/episode") {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return { data: episodes[Number(req.params.seriesId)] ?? [] };
    }
    return { status: 404 };
  });
}

beforeEach(async () => {
  await resetDb();
  setSetting("SONARR_URL", "http://sonarr:8989");
  allSeries = [];
  episodes = {};
  inFlight = 0;
  maxInFlight = 0;
});
afterEach(() => sonarr?.restore());

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => r.structuredContent.media as Array<Record<string, any>>;
const episodeCalls = () => sonarr.calls.filter((c) => c.url === "/api/v3/episode").map((c) => c.params.seriesId);

describe("analyzeEpisodes", () => {
  it("counts aired episodes with and without a file, per season", () => {
    const result = analyzeEpisodes([...season(1, 4, "all"), ...season(2, 4, [1, 4])]);
    assert.equal(result.released, 8);
    assert.equal(result.have, 6);
    assert.equal(result.missing, 2);
    assert.deepEqual(result.seasons.map((s) => [s.season, s.released, s.have, s.missing]), [[1, 4, 4, []], [2, 4, 2, [2, 3]]]);
  });

  it("does not count episodes that have not aired (future or undated) as missing", () => {
    const result = analyzeEpisodes([...season(1, 2, "all"), episode({ season: 1, number: 3, airs: FUTURE }), episode({ season: 1, number: 4, airs: null })]);
    assert.equal(result.missing, 0);
    assert.equal(result.unaired, 2);
    assert.equal(result.released, 2);
  });

  it("counts an episode with a file as released even with no air date or a future one", () => {
    const result = analyzeEpisodes([episode({ season: 1, number: 1, have: true, airs: null }), episode({ season: 1, number: 2, have: true, airs: FUTURE })]);
    assert.deepEqual([result.released, result.have, result.unaired], [2, 2, 0]);
  });

  it("uses the clock it is given for what has aired", () => {
    const eps = [episode({ season: 1, number: 1, airs: "2020-06-01T00:00:00Z" })];
    assert.equal(analyzeEpisodes(eps, Date.parse("2020-05-31T23:59:59Z")).missing, 0);
    assert.equal(analyzeEpisodes(eps, Date.parse("2020-06-01T00:00:00Z")).missing, 1, "aired exactly now counts as aired");
  });

  it("keeps season 0 specials out of the totals and reports them separately", () => {
    const result = analyzeEpisodes([...season(1, 2, "all"), ...season(0, 5, [1, 2])]);
    assert.deepEqual([result.released, result.missing], [2, 0]);
    assert.deepEqual(result.specials, { total: 5, have: 2 });
    assert.deepEqual(result.seasons.map((s) => s.season), [1]);
  });

  it("counts how many missing episodes are monitored", () => {
    const result = analyzeEpisodes([episode({ season: 1, number: 1, monitored: true }), episode({ season: 1, number: 2, monitored: false }), episode({ season: 1, number: 3, have: true })]);
    assert.deepEqual([result.missing, result.missingMonitored], [2, 1]);
  });

  it("sorts seasons and missing episodes numerically", () => {
    const result = analyzeEpisodes([episode({ season: 10, number: 2 }), episode({ season: 2, number: 11 }), episode({ season: 2, number: 3 })]);
    assert.deepEqual(result.seasons.map((s) => s.season), [2, 10]);
    assert.deepEqual(result.seasons[0]!.missing, [3, 11]);
  });
});

describe("episodeRanges", () => {
  it("joins runs and keeps single episodes", () => {
    assert.equal(episodeRanges([4, 5, 6, 9, 11, 12]), "E4-E6, E9, E11-E12");
    assert.equal(episodeRanges([7]), "E7");
    assert.equal(episodeRanges([]), "");
  });
  it("summarises a season with many separate holes", () => {
    const holes = Array.from({ length: 12 }, (_, i) => i * 2 + 1);
    assert.equal(episodeRanges(holes), "E1, E3, E5, E7, E9, E11, E13, E15 and 4 more gaps");
  });
});

describe("seasonRanges", () => {
  it("joins runs of seasons", () => {
    assert.equal(seasonRanges([1, 2, 3, 5, 7, 8]), "1-3, 5, 7-8");
    assert.equal(seasonRanges([4]), "4");
  });
});

describe("findSeries", () => {
  const list = [
    series(1, "Fargo", { year: 2014 }),
    series(2, "Fargo", { year: 2023 }),
    series(3, "The Wire"),
    series(4, "Marvel's Agents of S.H.I.E.L.D."),
    series(5, "Law & Order", { alternateTitles: [{ title: "Law and Order: Original" }] }),
    series(6, "Doctor Who (2005)", { year: 2005 }),
    series(7, "Céline"),
    series(8, "Star Trek"),
    series(9, "Star Trek: Voyager"),
    series(10, "Doctor Who Confidential"),
  ];

  it("matches ignoring case, punctuation, accents, '&' and a trailing year", () => {
    assert.equal((findSeries(list, "the WIRE") as any).series.id, 3);
    for (const typed of ["Marvel's Agents of S.H.I.E.L.D.", "marvels agents of shield", "Marvel\u2019s Agents of SHIELD"]) {
      assert.equal((findSeries(list, typed) as any).series.id, 4, typed);
    }
    assert.equal((findSeries(list, "law and order") as any).series.id, 5);
    assert.equal((findSeries(list, "Law & Order") as any).series.id, 5);
    assert.equal((findSeries(list, "doctor who") as any).series.id, 6, "the year in Sonarr's title does not stop an exact match beating 'Doctor Who Confidential'");
    assert.equal((findSeries(list, "Doctor Who (2005)") as any).series.id, 6);
    assert.equal((findSeries(list, "celine") as any).series.id, 7);
  });

  it("matches an alternate title", () => {
    assert.equal((findSeries(list, "Law and Order: Original") as any).series.id, 5);
  });

  it("returns every same-named show, or narrows by year", () => {
    assert.deepEqual((findSeries(list, "Fargo") as any).candidates.map((s: any) => s.id), [1, 2]);
    assert.equal((findSeries(list, "Fargo", 2023) as any).series.id, 2);
  });

  it("prefers an exact title over longer ones that contain it", () => {
    assert.equal((findSeries(list, "Star Trek") as any).series.id, 8);
  });

  it("falls back to a title containing the text: one match is used, several are offered", () => {
    assert.equal((findSeries(list, "voyager") as any).series.id, 9);
    assert.deepEqual((findSeries(list, "trek") as any).candidates.map((s: any) => s.id), [8, 9]);
  });

  it("finds nothing for an unknown or blank title", () => {
    assert.equal(findSeries(list, "Nonexistent Show"), null);
    assert.equal(findSeries(list, "   "), null);
    assert.equal(findSeries(list, "!!!"), null);
  });
});

describe("check_series_completeness", () => {
  it("says so when Sonarr isn't configured, without calling it", async () => {
    setSetting("SONARR_URL", "");
    sonarrFake();
    const result = await checkSeriesCompleteness("Anything");
    assert.equal(result.isError, true);
    assert.match(text(result), /Sonarr isn't configured/);
    assert.equal(sonarr.calls.length, 0);
  });

  it("calls a show complete when every aired episode has a file", async () => {
    allSeries = [series(1, "Breaking Bad", { status: "ended", monitored: false })];
    episodes[1] = [...season(1, 7), ...season(2, 13), ...season(0, 3, "none")];
    sonarrFake();
    const result = await checkSeriesCompleteness("breaking bad");
    assert.match(text(result), /^## Breaking Bad \(2010\) - Sonarr: ended, not monitored/);
    assert.match(text(result), /Complete: you have all 20 aired episodes across 2 seasons\./);
    assert.match(text(result), /Specials \(season 0, not counted above\): 0 of 3 downloaded\./);
    assert.doesNotMatch(text(result), /NOT complete/);
    assert.deepEqual(episodeCalls(), [1]);
  });

  // The whole reason this tool exists: Sonarr's own statistics call a show like
  // this "100%" because its missing episodes are unmonitored.
  it("finds the gaps Sonarr's own statistics hide in an unmonitored show", async () => {
    allSeries = [series(1, "Curb Your Enthusiasm", { monitored: false, statistics: { totalEpisodeCount: 163, episodeFileCount: 20, episodeCount: 20 } })];
    episodes[1] = [...season(1, 10), ...season(2, 10), ...season(3, 10, "none", { monitored: false })];
    sonarrFake();
    const result = await checkSeriesCompleteness("Curb Your Enthusiasm");
    assert.match(text(result), /NOT complete: you have 20 of 30 aired episodes \(10 missing\)\./);
    assert.match(text(result), /In Sonarr the show is not monitored \(Sonarr will not look for missing episodes\)\./);
    assert.match(text(result), /- Complete: seasons 1-2\./);
    assert.match(text(result), /- Season 3: none of 10 episodes\./);
  });

  it("lists which episodes are missing in a partly downloaded season", async () => {
    allSeries = [series(1, "Some Show", { monitored: true })];
    episodes[1] = [...season(1, 10, "all"), ...season(2, 12, [1, 2, 3, 10]), ...season(3, 6, [1, 6])];
    sonarrFake();
    const result = await checkSeriesCompleteness("Some Show");
    assert.match(text(result), /you have 16 of 28 aired episodes \(12 missing\)/);
    assert.match(text(result), /- Season 2: 4 of 12 - missing E4-E9, E11-E12\./);
    assert.match(text(result), /- Season 3: 2 of 6 - missing E2-E5\./);
  });

  it("says whether Sonarr is looking for the missing episodes", async () => {
    allSeries = [series(1, "Watched", { monitored: true }), series(2, "Ignored Episodes", { monitored: true })];
    episodes[1] = season(1, 3, [1]);
    episodes[2] = season(1, 3, [1], { monitored: false });
    sonarrFake();
    assert.match(text(await checkSeriesCompleteness("Watched")), /In Sonarr the show is monitored \(Sonarr is looking for 2 of them\)/);
    assert.match(text(await checkSeriesCompleteness("Ignored Episodes")), /In Sonarr the show is monitored, but its missing episodes are unmonitored/);
  });

  it("keeps not-yet-aired episodes out of the missing count and says they are coming", async () => {
    allSeries = [series(1, "Ongoing", { status: "continuing", monitored: true, nextAiring: "2999-01-08T02:00:00Z" })];
    episodes[1] = [...season(1, 8, "all"), ...season(2, 3, "all"), episode({ season: 2, number: 4, airs: FUTURE }), episode({ season: 2, number: 5, airs: FUTURE })];
    sonarrFake();
    const result = await checkSeriesCompleteness("Ongoing");
    assert.match(text(result), /Complete: you have all 11 aired episodes/);
    assert.match(text(result), /Not aired yet \(not counted as missing\): season 2 has 2\./);
    assert.match(text(result), /Next episode airs 2999-01-08\./);
  });

  it("handles a show that has not aired anything yet", async () => {
    allSeries = [series(1, "Upcoming", { status: "upcoming" })];
    episodes[1] = [episode({ season: 1, number: 1, airs: FUTURE }), episode({ season: 1, number: 2, airs: FUTURE })];
    sonarrFake();
    assert.match(text(await checkSeriesCompleteness("Upcoming")), /No episodes have aired yet \(2 upcoming\)\./);
  });

  // Found live: Curb Your Enthusiasm printed ten identical "none of 10 episodes" lines.
  it("collapses a run of seasons with nothing downloaded into one line", async () => {
    allSeries = [series(1, "Curb")];
    episodes[1] = [...season(1, 10, "none"), ...season(2, 10, "none"), ...season(3, 10, "none"), ...season(4, 8, [1]), ...season(5, 10, "none"), ...season(6, 4, "all")];
    sonarrFake();
    const lines = text(await checkSeriesCompleteness("Curb")).split("\n").filter((l) => l.startsWith("- "));
    assert.deepEqual(lines, [
      "- Complete: season 6.",
      "- Seasons 1-3: nothing downloaded (30 episodes).",
      "- Season 4: 1 of 8 - missing E2-E8.",
      "- Season 5: none of 10 episodes.",
    ]);
  });

  it("does not join empty seasons that are not next to each other", async () => {
    allSeries = [series(1, "Gappy")];
    episodes[1] = [...season(1, 3, "none"), ...season(2, 3, "all"), ...season(3, 3, "none")];
    sonarrFake();
    const lines = text(await checkSeriesCompleteness("Gappy")).split("\n").filter((l) => l.startsWith("- "));
    assert.deepEqual(lines, ["- Complete: season 2.", "- Season 1: none of 3 episodes.", "- Season 3: none of 3 episodes."]);
  });

  // Found live: Sonarr's title is already "Bluey (2018)", which printed "Bluey (2018) (2018)".
  it("does not repeat the year when Sonarr's title already ends with it", async () => {
    allSeries = [series(1, "Bluey (2018)", { year: 2018 }), series(2, "Plain", { year: 2001 })];
    episodes[1] = season(1, 2, [1]);
    episodes[2] = season(1, 2, [1]);
    sonarrFake();
    assert.match(text(await checkSeriesCompleteness("Bluey")), /^## Bluey \(2018\) - Sonarr/);
    const lines = text(await findSeriesGaps()).split("\n").filter((l) => l.startsWith("- "));
    assert.ok(lines.some((l) => l.startsWith("- Bluey (2018) - 1 of 2")) && lines.some((l) => l.startsWith("- Plain (2001) - 1 of 2")), lines.join("\n"));
  });

  it("caps a huge list of incomplete seasons", async () => {
    allSeries = [series(1, "Sesame Street")];
    episodes[1] = Array.from({ length: 50 }, (_, i) => season(i + 1, 2, [1])).flat();
    sonarrFake();
    const lines = text(await checkSeriesCompleteness("Sesame Street")).split("\n").filter((l) => l.startsWith("- Season"));
    assert.equal(lines.length, 40);
    assert.match(text(await checkSeriesCompleteness("Sesame Street")), /\.\.\.and 10 more seasons with missing episodes\./);
  });

  it("returns a table row with downloaded counts, network and what Sonarr will do", async () => {
    allSeries = [series(1, "Some Show", { year: 2015, network: "HBO", monitored: true })];
    episodes[1] = season(1, 10, [1, 2, 3]);
    sonarrFake();
    const result = await checkSeriesCompleteness("Some Show");
    assert.deepEqual(rows(result), [
      {
        kind: "show",
        title: "Some Show",
        year: 2015,
        posterUrl: null,
        libraries: null,
        genres: [],
        rating: null,
        detail: "Missing 7 - Sonarr is searching",
        show: { seasons: 1, episodes: 10, watchedEpisodes: null, ownedEpisodes: 3, network: "HBO" },
      },
    ]);
    assert.equal((result as any).structuredContent.append, false);
  });

  it("returns a complete show as 'Complete' in the row", async () => {
    allSeries = [series(1, "Done")];
    episodes[1] = season(1, 3);
    sonarrFake();
    assert.equal(rows(await checkSeriesCompleteness("Done"))[0]!.detail, "Complete");
  });

  it("asks which show when the title is ambiguous, and never guesses", async () => {
    allSeries = [series(1, "Fargo", { year: 2014 }), series(2, "Fargo", { year: 2023 })];
    sonarrFake();
    const result = await checkSeriesCompleteness("Fargo");
    assert.match(text(result), /"Fargo" matches 2 series in Sonarr: Fargo \(2014\); Fargo \(2023\)\. Ask again with the full title/);
    assert.equal(episodeCalls().length, 0);
    episodes[2] = season(1, 2);
    assert.match(text(await checkSeriesCompleteness("Fargo", 2023)), /^## Fargo \(2023\)/);
  });

  it("says so when Sonarr doesn't have the show", async () => {
    allSeries = [series(1, "The Wire")];
    sonarrFake();
    const result = await checkSeriesCompleteness("Nothing Like It");
    assert.equal(result.isError, undefined);
    assert.match(text(result), /No series matching "Nothing Like It" in Sonarr\./);
  });

  it("reports a Sonarr outage as an error", async () => {
    sonarrFake(() => ({ status: 500 }));
    const result = await checkSeriesCompleteness("Anything");
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to check Sonarr/);
  });

  it("does not claim Plex has the files", async () => {
    allSeries = [series(1, "Done")];
    episodes[1] = season(1, 3);
    sonarrFake();
    assert.match(text(await checkSeriesCompleteness("Done")), /doesn't check that Plex has scanned the files/);
  });
});

describe("find_series_gaps", () => {
  beforeEach(() => {
    allSeries = [
      series(1, "Big Sampler", { monitored: false }),
      series(2, "Nearly There", { monitored: true, status: "continuing" }),
      series(3, "Nothing Grabbed", { monitored: false }),
      series(4, "Complete Show", { monitored: true, statistics: { totalEpisodeCount: 6, episodeFileCount: 6 } }),
      series(5, "Complete Unmonitored", { monitored: false }),
      series(6, "Monitored Quiet", { monitored: true }),
    ];
    episodes[1] = [...season(1, 30, [1, 2, 3]), ...season(2, 30, "none")];
    episodes[2] = season(1, 10, [1, 2, 3, 4, 5, 6, 7, 8, 10]);
    episodes[3] = season(1, 20, "none");
    episodes[4] = season(1, 6);
    episodes[5] = [...season(1, 4), ...season(0, 2, "none")];
    episodes[6] = season(1, 5, [1, 2], { monitored: false });
  });

  it("ranks shows by how many aired episodes are missing", async () => {
    sonarrFake();
    const result = await findSeriesGaps({ limit: 50 });
    assert.deepEqual(rows(result).map((r) => r.title), ["Big Sampler", "Nothing Grabbed", "Monitored Quiet", "Nearly There"]);
    assert.match(text(result), /4 of 6 series have aired episodes without a file, 81 episodes in all\./);
  });

  it("summarises how many Sonarr is actively searching for and how many have nothing at all", async () => {
    sonarrFake();
    const result = await findSeriesGaps();
    assert.match(text(result), /Sonarr is actively looking for episodes of 1 of them; 1 have nothing downloaded at all\./);
  });

  it("describes each show with counts and what Sonarr will do", async () => {
    sonarrFake();
    const result = await findSeriesGaps();
    const lines = text(result).split("\n").filter((l) => l.startsWith("- "));
    assert.deepEqual(lines, [
      "- Big Sampler (2010) - 3 of 60 aired episodes, 57 missing - ended, not monitored (Sonarr will not look for missing episodes)",
      "- Nothing Grabbed (2010) - 0 of 20 aired episodes, 20 missing - ended, not monitored (Sonarr will not look for missing episodes)",
      "- Monitored Quiet (2010) - 2 of 5 aired episodes, 3 missing - ended, monitored, but its missing episodes are unmonitored",
      "- Nearly There (2010) - 9 of 10 aired episodes, 1 missing - continuing, monitored (Sonarr is looking for 1 of them)",
    ]);
  });

  it("returns table rows with progress data for the same shows", async () => {
    sonarrFake();
    const result = await findSeriesGaps();
    const nearly = rows(result).find((r) => r.title === "Nearly There")!;
    assert.deepEqual(nearly.show, { seasons: 1, episodes: 10, watchedEpisodes: null, ownedEpisodes: 9, network: "AMC" });
    assert.equal(nearly.detail, "Missing 1 - Sonarr is searching");
    assert.equal(nearly.libraries, null);
  });

  it("does not fetch episodes for shows whose every episode already has a file", async () => {
    sonarrFake();
    await findSeriesGaps();
    assert.deepEqual([...episodeCalls()].sort(), [1, 2, 3, 5, 6], "show 4 has every episode downloaded per its statistics");
  });

  it("filters by whether Sonarr monitors the show", async () => {
    sonarrFake();
    assert.deepEqual(rows(await findSeriesGaps({ monitored: "monitored" })).map((r) => r.title), ["Monitored Quiet", "Nearly There"]);
    assert.deepEqual(rows(await findSeriesGaps({ monitored: "unmonitored" })).map((r) => r.title), ["Big Sampler", "Nothing Grabbed"]);
    assert.equal(rows(await findSeriesGaps({ monitored: "any" })).length, 4);
  });

  it("'searching' means monitored AND with missing episodes Sonarr will look for (its wanted list)", async () => {
    sonarrFake();
    const result = await findSeriesGaps({ monitored: "searching" });
    assert.deepEqual(rows(result).map((r) => r.title), ["Nearly There"], "'Monitored Quiet' is monitored but its missing episodes are not");
    assert.match(text(result), /^## Series with missing episodes \(searching\)/);
    assert.match(text(await findSeriesGaps({ monitored: "searching", minMissing: 50 })), /No Sonarr series have aired episodes missing \(searching, at least 50 missing\)/);
  });

  it("filters by how many are missing, for 'nearly complete' shows", async () => {
    sonarrFake();
    assert.deepEqual(rows(await findSeriesGaps({ maxMissing: 5 })).map((r) => r.title), ["Monitored Quiet", "Nearly There"]);
    assert.deepEqual(rows(await findSeriesGaps({ minMissing: 20 })).map((r) => r.title), ["Big Sampler", "Nothing Grabbed"]);
    assert.deepEqual(rows(await findSeriesGaps({ minMissing: 3, maxMissing: 20 })).map((r) => r.title), ["Nothing Grabbed", "Monitored Quiet"]);
  });

  it("can hide shows that have nothing downloaded at all", async () => {
    sonarrFake();
    const result = await findSeriesGaps({ hideEmpty: true });
    assert.deepEqual(rows(result).map((r) => r.title), ["Big Sampler", "Monitored Quiet", "Nearly There"]);
    assert.match(text(result), /\(with some episodes downloaded\)/);
  });

  it("limits the list and says how many were left out", async () => {
    sonarrFake();
    const result = await findSeriesGaps({ limit: 2 });
    assert.equal(rows(result).length, 2);
    assert.match(text(result), /Listed the 2 with the most missing; 2 more are not listed/);
    assert.match(text(result), /4 of 6 series have aired episodes/, "the summary still covers all of them");
  });

  it("breaks ties alphabetically", async () => {
    allSeries = [series(1, "Zed"), series(2, "Alpha"), series(3, "Mid")];
    episodes[1] = season(1, 3, "none");
    episodes[2] = season(1, 3, "none");
    episodes[3] = season(1, 3, "none");
    sonarrFake();
    assert.deepEqual(rows(await findSeriesGaps()).map((r) => r.title), ["Alpha", "Mid", "Zed"]);
  });

  it("ignores specials and not-yet-aired episodes when ranking", async () => {
    allSeries = [series(1, "Only Specials Missing"), series(2, "Only Future Missing")];
    episodes[1] = [...season(1, 3), ...season(0, 10, "none")];
    episodes[2] = [...season(1, 3), episode({ season: 1, number: 4, airs: FUTURE })];
    sonarrFake();
    const result = await findSeriesGaps();
    assert.match(text(result), /No Sonarr series have aired episodes missing\. 2 series checked\./);
    assert.equal((result as any).structuredContent, undefined);
  });

  it("says so, with the filters used, when nothing matches", async () => {
    sonarrFake();
    const result = await findSeriesGaps({ monitored: "monitored", minMissing: 50 });
    assert.match(text(result), /No Sonarr series have aired episodes missing \(monitored, at least 50 missing\)\. 6 series checked\./);
  });

  it("fetches episodes with a small bounded concurrency", async () => {
    allSeries = Array.from({ length: 40 }, (_, i) => series(i + 1, `Show ${i + 1}`));
    for (const s of allSeries) episodes[s.id] = season(1, 2, [1]);
    sonarrFake();
    const result = await findSeriesGaps({ limit: 100 });
    assert.equal(rows(result).length, 40);
    assert.ok(maxInFlight > 1 && maxInFlight <= 8, `at most 8 requests in flight, saw ${maxInFlight}`);
  });

  it("fails as a whole if any show's episodes can't be read, rather than ranking with holes", async () => {
    sonarrFake((url, params) => (url === "/api/v3/episode" && params.seriesId === 3 ? { status: 500 } : undefined));
    const result = await findSeriesGaps();
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to check Sonarr/);
  });

  it("says so when Sonarr isn't configured", async () => {
    setSetting("SONARR_URL", "");
    sonarrFake();
    const result = await findSeriesGaps();
    assert.equal(result.isError, true);
    assert.equal(sonarr.calls.length, 0);
  });

  it("clamps silly inputs: a limit of 0, a negative minimum", async () => {
    sonarrFake();
    assert.equal(rows(await findSeriesGaps({ limit: 0 })).length, 1);
    assert.equal(rows(await findSeriesGaps({ minMissing: -5 })).length, 4);
  });
});
