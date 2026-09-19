import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plexClient } from "../src/clients.js";
import { searchEpisodes } from "../src/tools/plexEpisodes.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb } from "./helpers.js";

const SECTIONS = [
  { key: "1", type: "movie", title: "Movies" },
  { key: "3", type: "show", title: "TV Shows" },
  { key: "4", type: "show", title: "4k TV Shows" },
  { key: "5", type: "show", title: "Sports" },
];
type Lib = Record<string, { shows: any[]; episodes: any[] }>;
let lib: Lib;
let fake: ReturnType<typeof fakeApi>;

const show = (rk: string, title: string, year = 2010) => ({ ratingKey: rk, title, year, guid: `plex://show/${title}-${year}` });
const at = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);
const ep = (showTitle: string, season: number, number: number, title: string, aired: string | null, extra: Record<string, unknown> = {}) => ({
  grandparentTitle: showTitle,
  parentIndex: season,
  index: number,
  title,
  summary: `Summary of ${title}.`,
  originallyAvailableAt: aired ?? undefined,
  thumb: `/library/metadata/${number}/thumb/1`,
  grandparentThumb: `/library/metadata/${showTitle.length}/thumb/9`,
  ...extra,
});

function plexFake(overrides?: (url: string) => any) {
  fake = fakeApi(plexClient, (req) => {
    const custom = overrides?.(req.url);
    if (custom) return custom;
    if (req.url === "/library/sections") return { data: { MediaContainer: { Directory: SECTIONS } } };
    let m = req.url.match(/^\/library\/sections\/(\d+)\/all$/);
    if (m) {
      const l = lib[m[1]!] ?? { shows: [], episodes: [] };
      const p = req.params;
      if (p.type === 2) return { data: { MediaContainer: { Metadata: l.shows.filter((s) => s.title.toLowerCase().includes(String(p.title).toLowerCase())) } } };
      // type 4: emulate Plex's episode filters (title contains, air-date range, episode number)
      let items = l.episodes;
      if (p.title) items = items.filter((e) => e.title.toLowerCase().includes(String(p.title).toLowerCase()));
      if (p["originallyAvailableAt>>"]) items = items.filter((e) => e.originallyAvailableAt && e.originallyAvailableAt >= String(p["originallyAvailableAt>>"]));
      if (p["originallyAvailableAt<<"]) items = items.filter((e) => e.originallyAvailableAt && e.originallyAvailableAt <= String(p["originallyAvailableAt<<"]));
      if (p.index !== undefined) items = items.filter((e) => e.index === p.index);
      return { data: { MediaContainer: { Metadata: items } } };
    }
    m = req.url.match(/^\/library\/metadata\/(\w+)\/allLeaves$/);
    if (m) {
      const found = Object.values(lib).flatMap((l) => l.shows.map((s) => ({ s, l }))).find(({ s }) => s.ratingKey === m![1]);
      return { data: { MediaContainer: { Metadata: found ? found.l.episodes.filter((e) => e.grandparentTitle === found.s.title) : [] } } };
    }
    return { status: 404 };
  });
}

beforeEach(async () => {
  await resetDb();
  setSetting("PLEX_URL", "http://plex:32400");
  lib = { "3": { shows: [], episodes: [] }, "4": { shows: [], episodes: [] }, "5": { shows: [], episodes: [] } };
});
afterEach(() => fake?.restore());

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => (r.structuredContent?.media ?? []) as any[];
const lines = (r: any) => text(r).split("\n").filter((l) => l.startsWith("- "));
const calls = (re: RegExp) => fake.calls.filter((c) => re.test(c.url));

describe("search_episodes: input checks", () => {
  it("needs Plex, and something to search for", async () => {
    setSetting("PLEX_URL", "");
    plexFake();
    assert.equal((await searchEpisodes({ text: "x" })).isError, true);
    assert.equal(fake.calls.length, 0);
    setSetting("PLEX_URL", "http://plex:32400");
    const none = await searchEpisodes({});
    assert.equal(none.isError, true);
    assert.match(text(none), /Name a show, or give words for the episode title/);
    assert.equal(calls(/all$/).length, 0);
  });

  it("validates dates, ordering, and that an episode number comes with a season", async () => {
    plexFake();
    assert.match(text(await searchEpisodes({ airedFrom: "March 2026" })), /airedFrom must be a date like 2026-09-01/);
    assert.match(text(await searchEpisodes({ airedTo: "2026-13" })), /airedTo must be a date/);
    assert.match(text(await searchEpisodes({ airedFrom: "2026-05-01", airedTo: "2026-04-01" })), /airedFrom is after airedTo/);
    assert.match(text(await searchEpisodes({ show: "X", episode: 3 })), /give its season as well/);
    assert.match(text(await searchEpisodes({ text: "x", episodeType: "finale" })), /only be found within one show/);
    assert.equal(calls(/all$/).length, 0, "nothing was asked of Plex");
  });
});

describe("search_episodes: within a named show (titles and plots)", () => {
  beforeEach(() => {
    lib["3"] = {
      shows: [show("10", "Entourage")],
      episodes: [
        ep("Entourage", 3, 10, "I Wanna Be Sedated", "2007-09-09", { summary: "Vince faces a chorus of insults from the cast." }),
        ep("Entourage", 1, 1, "Pilot", "2004-07-18", { summary: "Vince meets a director." }),
        ep("Entourage", 3, 1, "Sorry Ari", "2006-06-11"),
        ep("Entourage", 3, 11, "Insults and Injuries", "2007-09-16", { viewCount: 1, lastViewedAt: at("2026-01-02") }),
        ep("Entourage", 0, 1, "A Special", "2010-01-01", { summary: "insults insults" }),
      ],
    };
    lib["4"] = { shows: [show("20", "Entourage")], episodes: [ep("Entourage", 3, 10, "I Wanna Be Sedated", "2007-09-09", { viewCount: 2, lastViewedAt: at("2026-03-03") })] };
  });

  it("finds an episode by a word in its PLOT that is not in its title", async () => {
    plexFake();
    const result = await searchEpisodes({ show: "entourage", text: "insults" });
    assert.match(text(result), /^## Entourage episodes: "insults" in titles and plots\n2 matching episodes/);
    assert.deepEqual(lines(result).map((l) => l.split(" - ")[0]), ['- Entourage S3E11 "Insults and Injuries"', '- Entourage S3E10 "I Wanna Be Sedated"'], "the title match comes first, then the plot-only match");
    assert.match(lines(result)[1]!, /plot: Vince faces a chorus of insults from the cast\.$/);
  });

  it("requires every word, in any order, in the title or plot", async () => {
    plexFake();
    assert.equal(rows(await searchEpisodes({ show: "Entourage", text: "chorus vince" })).length, 1);
    assert.equal(rows(await searchEpisodes({ show: "Entourage", text: "chorus director" })).length, 0);
    assert.match(text(await searchEpisodes({ show: "Entourage", text: "zzz" })), /^No episodes of Entourage in Plex match "zzz" in titles and plots\. Plex holds 4 episodes of it\.$/);
  });

  it("matches ignoring case, accents and punctuation", async () => {
    lib["3"]!.episodes.push(ep("Entourage", 2, 5, "Café Society", "2005-06-01"));
    plexFake();
    assert.equal(rows(await searchEpisodes({ show: "Entourage", text: "SORRY, ari!" })).length, 1);
    for (const typed of ["cafe society", "CAFÉ", "Cafe   Society!"]) assert.equal(rows(await searchEpisodes({ show: "Entourage", text: typed })).length, 1, typed);
  });

  it("never lists more than 100 episodes, whatever limit is asked for", async () => {
    lib["4"]!.episodes = [];
    lib["3"]!.episodes = Array.from({ length: 130 }, (_, i) => ep("Entourage", 1, i + 1, `Episode ${i + 1}`, "2005-01-01"));
    plexFake();
    assert.equal(rows(await searchEpisodes({ show: "Entourage", limit: 500 })).length, 100);
    assert.match(text(await searchEpisodes({ show: "Entourage", limit: 500 })), /130 matching episodes, listed the first 100/);
  });

  it("leaves out season 0 specials", async () => {
    plexFake();
    assert.equal(rows(await searchEpisodes({ show: "Entourage", text: "insults" })).length, 2, "the special also says insults");
  });

  it("shows a show held in HD and 4K once, with both libraries and the furthest watch state", async () => {
    plexFake();
    const [row] = rows(await searchEpisodes({ show: "Entourage", season: 3, episode: 10 }));
    assert.deepEqual(row.libraries, ["TV Shows", "4k TV Shows"]);
    assert.match(row.detail, /watched 2026-03-03/);
    assert.equal(rows(await searchEpisodes({ show: "Entourage", season: 3, episode: 10 })).length, 1);
  });

  it("filters by season, by season and episode, and by air date", async () => {
    plexFake();
    assert.equal(rows(await searchEpisodes({ show: "Entourage", season: 3 })).length, 3);
    assert.deepEqual(rows(await searchEpisodes({ show: "Entourage", season: 3, episode: 1 })).map((r) => r.detail.slice(0, 5)), ["S3E01"]);
    assert.deepEqual(rows(await searchEpisodes({ show: "Entourage", airedFrom: "2007-01-01", airedTo: "2007-09-09" })).map((r) => r.detail.slice(0, 6)), ["S3E10 "]);
    assert.equal(rows(await searchEpisodes({ show: "Entourage", airedFrom: "2007-09-16" })).length, 1, "bounds are inclusive");
  });

  it("finds season premieres and season finales (the last episode Plex holds of each season)", async () => {
    plexFake();
    assert.deepEqual(rows(await searchEpisodes({ show: "Entourage", episodeType: "premiere" })).map((r) => r.detail.slice(0, 5)), ["S1E01", "S3E01"]);
    assert.deepEqual(rows(await searchEpisodes({ show: "Entourage", episodeType: "finale" })).map((r) => r.detail.slice(0, 5)), ["S1E01", "S3E11"], "a one-episode season is its own finale");
  });

  it("lists in season and episode order and pages with a limit", async () => {
    plexFake();
    const result = await searchEpisodes({ show: "Entourage", limit: 2 });
    assert.deepEqual(rows(result).map((r) => r.detail.slice(0, 5)), ["S1E01", "S3E01"]);
    assert.match(text(result), /4 matching episodes, listed the first 2/);
    assert.equal(rows(await searchEpisodes({ show: "Entourage", limit: 0 })).length, 1);
    assert.equal(rows(await searchEpisodes({ show: "Entourage", limit: 999 })).length, 4);
  });

  it("returns table rows: the show, the episode and its plot, the show's poster, never a raw Plex URL", async () => {
    plexFake();
    const [row] = rows(await searchEpisodes({ show: "Entourage", text: "chorus" }));
    assert.deepEqual(row, {
      kind: "show",
      title: "Entourage",
      year: null,
      posterUrl: "/api/plex/image?path=%2Flibrary%2Fmetadata%2F9%2Fthumb%2F9",
      libraries: ["TV Shows", "4k TV Shows"],
      genres: [],
      rating: null,
      detail: 'S3E10 "I Wanna Be Sedated" - 2007-09-09 - watched 2026-03-03 - Vince faces a chorus of insults from the cast.',
    });
  });

  it("asks which show when several match, and says when none does", async () => {
    lib["5"] = { shows: [show("30", "Entourage: Behind", 2015)], episodes: [] };
    plexFake();
    assert.equal(rows(await searchEpisodes({ show: "Entourage" })).length, 4, "an exact title beats a longer one that contains it");
    lib["3"]!.shows.push(show("11", "Fargo", 1996));
    lib["4"]!.shows.push(show("21", "Fargo", 2014));
    assert.match(text(await searchEpisodes({ show: "Fargo" })), /matches several shows in Plex: Fargo \(1996\); Fargo \(2014\)\. Ask again with the full title\./);
    assert.match(text(await searchEpisodes({ show: "Nothing Like It" })), /^No show matching "Nothing Like It" in Plex\.$/);
  });

  it("reads episodes with one call per library copy, not one per episode", async () => {
    plexFake();
    await searchEpisodes({ show: "Entourage", text: "insults" });
    assert.equal(calls(/allLeaves$/).length, 2);
  });
});

describe("search_episodes: across the library (titles and air dates only)", () => {
  beforeEach(() => {
    lib["3"] = {
      shows: [],
      episodes: [
        ep("Ballers", 4, 2, "Don't You Wanna Be Obama?", "2019-08-04"),
        ep("Bob's Burgers", 10, 2, "Boys Just Wanna Have Fungus", "2019-10-20"),
        ep("Alone", 13, 12, "Subzero", "2026-09-03"),
        ep("Alone", 13, 1, "Premiere Night", "2026-08-13"),
        ep("Season Openers", 5, 1, "New Start", "2026-09-10"),
      ],
    };
    lib["4"] = { shows: [], episodes: [ep("Alone", 13, 12, "Subzero", "2026-09-03")] };
    lib["5"] = { shows: [], episodes: [ep("Tour", 1, 1, "Wanna Race", "2026-07-01")] };
  });

  it("searches episode titles across every show library, newest first, and says plots were not searched", async () => {
    plexFake();
    const result = await searchEpisodes({ text: "wanna" });
    assert.deepEqual(lines(result).map((l) => l.split(" - ")[0]), ['- Tour S1E01 "Wanna Race"', '- Bob\'s Burgers S10E02 "Boys Just Wanna Have Fungus"', '- Ballers S4E02 "Don\'t You Wanna Be Obama?"']);
    assert.match(text(result), /Only episode titles were searched \(Plex cannot search plots across the library\); to search plots, name the show\./);
    assert.doesNotMatch(text(result), /plot:/);
    assert.doesNotMatch(JSON.stringify(rows(result)), /Summary of/, "no plot text: it was not searched");
  });

  it("asks Plex to filter by title and sort by air date, and does not ask for plots", async () => {
    plexFake();
    await searchEpisodes({ text: "wanna" });
    const params = calls(/\/all$/)[0]!.params;
    assert.deepEqual([params.type, params.title, params.sort], [4, "wanna", "originallyAvailableAt:desc"]);
  });

  it("requires every word of the title, whatever Plex matched", async () => {
    plexFake((url) => (/\/all$/.test(url) ? { data: { MediaContainer: { Metadata: [ep("A", 1, 1, "Wanna Be", "2020-01-01"), ep("B", 1, 1, "Wanna Race", "2020-01-02")] } } } : undefined));
    assert.deepEqual(rows(await searchEpisodes({ text: "wanna be" })).map((r) => r.title), ["A"]);
  });

  it("searches by air-date range, passing both bounds to Plex", async () => {
    plexFake();
    const result = await searchEpisodes({ airedFrom: "2026-08-01", airedTo: "2026-09-30" });
    assert.deepEqual(rows(result).map((r) => r.detail.slice(0, 6)), ["S5E01 ", "S13E12", "S13E01"]);
    const params = calls(/\/all$/)[0]!.params;
    assert.deepEqual([params["originallyAvailableAt>>"], params["originallyAvailableAt<<"]], ["2026-08-01", "2026-09-30"]);
    assert.match(text(result), /^## Episodes: aired 2026-08-01 to 2026-09-30\n/);
  });

  it("lists an episode held in HD and 4K once", async () => {
    plexFake();
    const result = await searchEpisodes({ text: "subzero" });
    assert.equal(rows(result).length, 1);
    assert.deepEqual(rows(result)[0].libraries, ["TV Shows", "4k TV Shows"]);
  });

  it("finds season premieres library-wide (episode 1), asking Plex for index 1 and checking again", async () => {
    plexFake();
    const result = await searchEpisodes({ airedFrom: "2026-08-01", episodeType: "premiere" });
    assert.deepEqual(rows(result).map((r) => r.detail.slice(0, 6)), ["S5E01 ", "S13E01"]);
    assert.equal(calls(/\/all$/)[0]!.params.index, 1);
    plexFake((url) => (/\/all$/.test(url) ? { data: { MediaContainer: { Metadata: [ep("A", 1, 1, "x", "2026-09-01"), ep("B", 1, 5, "y", "2026-09-02")] } } } : undefined));
    assert.deepEqual(rows(await searchEpisodes({ airedFrom: "2026-08-01", episodeType: "premiere" })).map((r) => r.title), ["A"], "a server that ignores the index filter is not trusted");
  });

  it("applies season and episode numbers too", async () => {
    plexFake();
    assert.deepEqual(rows(await searchEpisodes({ text: "subzero", season: 13, episode: 12 })).length, 1);
    assert.equal(rows(await searchEpisodes({ text: "subzero", season: 12 })).length, 0);
  });

  it("leaves out libraries the skip setting names, unless the library filter names one", async () => {
    setSetting("PLEX_SKIP_LIBRARIES", "Sports");
    plexFake();
    assert.equal(rows(await searchEpisodes({ text: "wanna race" })).length, 0);
    assert.equal(rows(await searchEpisodes({ text: "wanna race", library: "sports" })).length, 1);
    assert.match(text(await searchEpisodes({ text: "x", library: "anime" })), /No show library matching "anime" in Plex\. Libraries: TV Shows, 4k TV Shows, Sports\./);
  });

  it("says so when nothing matches, and reports an outage as an error", async () => {
    plexFake();
    assert.match(text(await searchEpisodes({ text: "zzzz" })), /^No episodes in Plex match "zzzz" in the episode title\.$/);
    fake.restore();
    plexFake(() => ({ status: 500 }));
    const down = await searchEpisodes({ text: "wanna" });
    assert.equal(down.isError, true);
    assert.match(text(down), /Failed to search Plex episodes/);
  });
});
