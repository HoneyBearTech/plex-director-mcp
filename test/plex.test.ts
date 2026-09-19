import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plexClient } from "../src/clients.js";
import { getOwnedTmdbIndex, resetOwnedTmdbIndexCache, searchPlexLibrary } from "../src/tools/plex.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb, type RecordedRequest } from "./helpers.js";

const SECTIONS = [
  { key: "1", type: "movie", title: "Movies" },
  { key: "2", type: "movie", title: "4k Movies" },
  { key: "3", type: "show", title: "TV Shows" },
  { key: "4", type: "show", title: "4k TV Shows" },
  { key: "5", type: "show", title: "Sports" },
];
const GENRES: Record<string, Array<{ key: string; title: string }>> = {
  "1": [{ key: "930", title: "Horror" }, { key: "106", title: "Action" }],
  "2": [{ key: "106", title: "Action" }],
  "3": [{ key: "999", title: "Drama" }, { key: "930", title: "Horror" }],
  "4": [{ key: "999", title: "Drama" }],
  "5": [],
};

const movie = (title: string, year: number, extra: Record<string, unknown> = {}) => ({
  title,
  titleSort: title,
  year,
  thumb: `/library/metadata/${year}/thumb/1`,
  audienceRating: 7.44,
  Genre: [{ tag: "Horror" }, { tag: "Thriller" }],
  Guid: [{ id: `imdb://tt${year}` }, { id: `tmdb://${year}` }],
  ...extra,
});

const show = (title: string, year: number, extra: Record<string, unknown> = {}) => ({
  title,
  titleSort: title,
  year,
  thumb: `/library/metadata/${year}/thumb/2`,
  audienceRating: 8.6,
  studio: "HBO",
  childCount: 5,
  leafCount: 62,
  viewedLeafCount: 40,
  Genre: [{ tag: "Drama" }],
  Guid: [{ id: `imdb://tt${year}` }, { id: `tmdb://${year}` }, { id: `tvdb://${year + 1000}` }],
  ...extra,
});

let fake: ReturnType<typeof fakeApi>;
let library: Record<string, any[]>;
let hubActors: Array<{ id: number; tag: string }>;

function plexFake(overrides?: (req: RecordedRequest) => any) {
  fake = fakeApi(plexClient, (req) => {
    const custom = overrides?.(req);
    if (custom) return custom;
    if (req.url === "/library/sections") return { data: { MediaContainer: { Directory: SECTIONS } } };
    let m = req.url.match(/^\/library\/sections\/(\d+)\/genre$/);
    if (m) return { data: { MediaContainer: { Directory: GENRES[m[1]!] ?? [] } } };
    if (req.url === "/hubs/search") return { data: { MediaContainer: { Hub: [{ type: "actor", Directory: hubActors }, { type: "movie" }] } } };
    m = req.url.match(/^\/library\/sections\/(\d+)\/all$/);
    if (m) {
      const items = library[m[1]!] ?? [];
      const size = Number(req.params["X-Plex-Container-Size"] ?? items.length);
      const start = Number(req.params["X-Plex-Container-Start"] ?? 0);
      return { data: { MediaContainer: { totalSize: items.length, Metadata: items.slice(start, start + size) } } };
    }
    return { status: 404 };
  });
}

beforeEach(async () => {
  await resetDb();
  setSetting("PLEX_URL", "http://plex:32400");
  library = { "1": [], "2": [], "3": [], "4": [], "5": [] };
  hubActors = [];
  resetOwnedTmdbIndexCache();
});
afterEach(() => fake?.restore());

const textOf = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const allCalls = () => fake.calls.filter((c) => /\/all$/.test(c.url));

describe("searchPlexLibrary: input checks", () => {
  it("explains that Plex isn't configured", async () => {
    setSetting("PLEX_URL", "");
    plexFake();
    const result = await searchPlexLibrary({ genre: "Horror" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Plex isn't configured/);
    assert.equal(fake.calls.length, 0, "no request is made");
  });
  it("requires at least one filter", async () => {
    plexFake();
    const result = await searchPlexLibrary({});
    assert.equal(result.isError, true);
    assert.match(textOf(result), /at least one of: title, genre, actor, year, library/);
    assert.equal(fake.calls.length, 0);
  });
});

describe("searchPlexLibrary: resolving genre and actor names", () => {
  it("resolves a genre name (case-insensitively) to its tag id and queries with it", async () => {
    plexFake();
    await searchPlexLibrary({ genre: "hORROR" });
    assert.ok(allCalls().length > 0);
    for (const call of allCalls()) assert.equal(call.params.genre, "930");
  });

  it("lists the available genres when the name is unknown", async () => {
    plexFake();
    const movies = await searchPlexLibrary({ genre: "Nonexistent", mediaType: "movie" });
    assert.equal(movies.isError, true);
    assert.match(textOf(movies), /No genre "Nonexistent" in Plex\. Available genres: Action, Horror\./);
    const both = await searchPlexLibrary({ genre: "Nonexistent" });
    assert.match(textOf(both), /Available genres: Action, Drama, Horror\./, "shows' genres count when shows are searched");
    assert.equal(allCalls().length, 0);
  });

  it("resolves an actor through hub search, once per person even if listed per library", async () => {
    hubActors = [{ id: 3126, tag: "Harrison Ford" }, { id: 3126, tag: "Harrison Ford" }];
    plexFake();
    await searchPlexLibrary({ actor: "harrison ford" });
    for (const call of allCalls()) assert.equal(call.params.actor, "3126");
  });

  it("asks for the full name when several different people match", async () => {
    hubActors = [{ id: 1, tag: "Harrison Ford" }, { id: 2, tag: "Harrison Ford Jr." }];
    plexFake();
    const result = await searchPlexLibrary({ actor: "Harrison" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /matches several people in Plex: Harrison Ford, Harrison Ford Jr\./);
  });

  it("prefers an exact name match over near matches", async () => {
    hubActors = [{ id: 1, tag: "Harrison Ford" }, { id: 2, tag: "Harrison Ford Jr." }];
    plexFake();
    await searchPlexLibrary({ actor: "Harrison Ford" });
    for (const call of allCalls()) assert.equal(call.params.actor, "1");
  });

  it("reports an actor who isn't in the library", async () => {
    plexFake();
    const result = await searchPlexLibrary({ actor: "Zzzz Qqqq" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No actor matching "Zzzz Qqqq"/);
  });
});

describe("searchPlexLibrary: results", () => {
  const rowsOf = (r: any) => r.structuredContent.media as any[];
  const bullets = (r: { content: Array<{ text: string }> }) => textOf(r).split("\n").filter((l) => l.startsWith("- "));

  it("mediaType movie searches every movie library and no show library", async () => {
    library["1"] = [movie("Heat", 1995)];
    library["2"] = [movie("Heat", 1995)];
    library["3"] = [show("Heat Show", 2001)];
    plexFake();
    const result = await searchPlexLibrary({ title: "heat", mediaType: "movie" });
    assert.deepEqual(allCalls().map((c) => c.url).sort(), ["/library/sections/1/all", "/library/sections/2/all"]);
    assert.doesNotMatch(textOf(result), /Heat Show/);
  });

  it("passes title and year through and asks Plex for GUIDs and every match", async () => {
    library["1"] = [movie("Heat", 1995)];
    plexFake();
    const result = await searchPlexLibrary({ title: "heat", year: 1995 });
    const call = allCalls()[0]!;
    assert.equal(call.params.title, "heat");
    assert.equal(call.params.year, 1995);
    assert.equal(call.params.includeGuids, 1);
    assert.equal(call.params["X-Plex-Container-Size"], 5000, "everything is fetched so movies can be grouped and counted correctly");
    assert.deepEqual(bullets(result), ["- Heat (1995) - Movies - Horror, Thriller"]);
  });

  it("makes a movie held in several libraries ONE entry with its libraries stacked", async () => {
    library["1"] = [movie("Heat", 1995), movie("Ronin", 1998)];
    library["2"] = [movie("Heat", 1995)];
    plexFake();
    const result = await searchPlexLibrary({ title: "x" });
    assert.deepEqual(rowsOf(result).map((r) => [r.title, r.libraries]), [["Heat", ["Movies", "4k Movies"]], ["Ronin", ["Movies"]]]);
    assert.match(textOf(result), /2 matching movies\./);
    assert.deepEqual(bullets(result), ["- Heat (1995) - Movies, 4k Movies - Horror, Thriller", "- Ronin (1998) - Movies - Horror, Thriller"]);
  });

  it("groups by TMDb id, so a remake with the same title is a separate movie", async () => {
    library["1"] = [movie("Dune", 1984, { Guid: [{ id: "tmdb://841" }] }), movie("Dune", 2021, { Guid: [{ id: "tmdb://438631" }] })];
    library["2"] = [movie("Dune", 2021, { Guid: [{ id: "tmdb://438631" }] })];
    plexFake();
    const rows = rowsOf(await searchPlexLibrary({ title: "dune" }));
    assert.deepEqual(rows.map((r) => [r.year, r.libraries]), [[1984, ["Movies"]], [2021, ["Movies", "4k Movies"]]]);
  });

  it("falls back to title and year when Plex has no TMDb id", async () => {
    library["1"] = [{ title: "Home Movie", titleSort: "Home Movie", year: 2010 }];
    library["2"] = [{ title: "Home Movie", titleSort: "Home Movie", year: 2010 }];
    plexFake();
    const rows = rowsOf(await searchPlexLibrary({ title: "home" }));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].libraries, ["Movies", "4k Movies"]);
  });

  it("sorts by Plex's sort title across libraries and honours the limit", async () => {
    library["1"] = [movie("Alien", 1979, { titleSort: "Alien" }), movie("The Thing", 1982, { titleSort: "Thing", Guid: [{ id: "tmdb://1091" }] })];
    library["2"] = [movie("Blade Runner", 1982, { titleSort: "Blade Runner", Guid: [{ id: "tmdb://78" }] })];
    plexFake();
    const result = await searchPlexLibrary({ year: 1982, limit: 2 });
    assert.deepEqual(rowsOf(result).map((m) => m.title), ["Alien", "Blade Runner"], "The Thing sorts under T, not 'The', and is cut by the limit");
    assert.match(textOf(result), /3 matching movies, listed 1-2\./);
    assert.match(textOf(result), /1 more are not listed: call again with offset 2/);
  });

  it("attaches structured rows for the web table", async () => {
    library["2"] = [movie("Blade Runner 2049", 2017, { thumb: "/library/metadata/91684/thumb/123" })];
    plexFake();
    const result = await searchPlexLibrary({ title: "blade" });
    assert.deepEqual(rowsOf(result), [
      {
        kind: "movie",
        title: "Blade Runner 2049",
        year: 2017,
        posterUrl: "/api/plex/image?path=%2Flibrary%2Fmetadata%2F91684%2Fthumb%2F123",
        libraries: ["4k Movies"],
        genres: ["Horror", "Thriller"],
        rating: 7.44,
        detail: null,
      },
    ]);
  });

  it("never puts the Plex token or a raw Plex URL in a poster URL", async () => {
    library["1"] = [movie("Heat", 1995)];
    plexFake();
    const rows = rowsOf(await searchPlexLibrary({ title: "heat" }));
    assert.match(rows[0].posterUrl, /^\/api\/plex\/image\?path=/);
    assert.doesNotMatch(JSON.stringify(rows), /X-Plex-Token|http:\/\/plex/);
  });

  it("shows titles containing pipes and backslashes verbatim", async () => {
    library["1"] = [movie("A|B", 2001), movie("Ends with \\", 2002)];
    plexFake();
    const result = await searchPlexLibrary({ title: "x" });
    assert.deepEqual(bullets(result).map((l) => l.split(" - ")[0]), ["- A|B (2001)", "- Ends with \\ (2002)"]);
    assert.deepEqual(rowsOf(result).map((r) => r.title), ["A|B", "Ends with \\"]);
  });

  it("handles items with no rating, year or poster", async () => {
    library["1"] = [{ title: "Mystery", titleSort: "Mystery" }];
    plexFake();
    const result = await searchPlexLibrary({ title: "mystery" });
    assert.deepEqual(bullets(result), ["- Mystery (year unknown) - Movies"]);
    assert.deepEqual(rowsOf(result)[0].posterUrl, null);
    assert.equal(rowsOf(result)[0].rating, null);
  });

  it("says so when nothing matches", async () => {
    plexFake();
    const result = await searchPlexLibrary({ title: "nothing" });
    assert.equal(result.isError, undefined);
    assert.match(textOf(result), /No movies or shows in Plex match title "nothing"/);
    assert.match(textOf(await searchPlexLibrary({ title: "nothing", mediaType: "movie" })), /No movies in Plex match title "nothing"/);
    assert.match(textOf(await searchPlexLibrary({ title: "nothing", mediaType: "show" })), /No shows in Plex match title "nothing"/);
  });

  it("reports a Plex outage as an error, not as an empty library", async () => {
    plexFake(() => ({ status: 500 }));
    const result = await searchPlexLibrary({ title: "heat" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Failed to search Plex/);
  });

  // Regression: the reply once told the user "only the first 100 of 174 rows are shown",
  // because the model was told the text was abbreviated. It now isn't.
  it("never talks about rows, truncation or 'first N' in what the model reads", async () => {
    library["1"] = Array.from({ length: 150 }, (_, i) => movie(`M${String(i).padStart(3, "0")}`, 2000, { Guid: [{ id: `tmdb://${i}` }] }));
    plexFake();
    const text = textOf(await searchPlexLibrary({ title: "m", limit: 150 }));
    assert.doesNotMatch(text, /\brows?\b|only the first|abbreviat|to save space/i);
    assert.equal(text.split("\n").filter((l) => l.startsWith("- ")).length, 150, "every returned movie is listed");
  });
});

describe("searchPlexLibrary: library filter", () => {
  beforeEach(() => {
    library["1"] = [movie("Heat", 1995)];
    library["2"] = [movie("Heat", 1995), movie("Ronin", 1998)];
  });

  it("searches only libraries whose name contains the text, case-insensitively", async () => {
    plexFake();
    const result = await searchPlexLibrary({ title: "x", library: "4K", mediaType: "movie" });
    assert.deepEqual(allCalls().map((c) => c.url), ["/library/sections/2/all"]);
    const rows = (result as any).structuredContent.media as any[];
    assert.deepEqual(rows.map((r) => r.libraries), [["4k Movies"], ["4k Movies"]]);
    assert.match(textOf(result), /in "4k Movies"/);
  });

  it("works as the only filter (list everything in a library)", async () => {
    plexFake();
    const result = await searchPlexLibrary({ library: "movies" });
    assert.equal(result.isError, undefined);
    assert.equal(allCalls().length, 2, "'movies' matches both Movies and 4k Movies, and no show library");
  });

  it("resolves a genre against every library even if the filtered library doesn't list it", async () => {
    plexFake();
    // Horror (930) exists only in section 1's genre list; the search is restricted to the 4K library.
    await searchPlexLibrary({ genre: "Horror", library: "4k", mediaType: "movie" });
    assert.deepEqual(allCalls().map((c) => c.url), ["/library/sections/2/all"]);
    assert.equal(allCalls()[0]!.params.genre, "930");
  });

  it("lists the libraries of the searched kind when none match", async () => {
    plexFake();
    const result = await searchPlexLibrary({ title: "x", library: "anime", mediaType: "movie" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No movie library matching "anime" in Plex\. Libraries: Movies, 4k Movies\./);
    assert.match(textOf(await searchPlexLibrary({ title: "x", library: "anime", mediaType: "show" })), /No show library matching "anime" in Plex\. Libraries: TV Shows, 4k TV Shows, Sports\./);
    assert.equal(allCalls().length, 0);
  });
});

describe("searchPlexLibrary: paging and large results", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => movie(`Movie ${String(i).padStart(3, "0")}`, 2000, { titleSort: `Movie ${String(i).padStart(3, "0")}`, Guid: [{ id: `tmdb://${i}` }] }));
  const titles = (r: any) => (r.structuredContent.media as any[]).map((m) => m.title);

  it("allows up to 500 movies in one call (the old cap was 100) and clamps beyond that", async () => {
    library["1"] = many(600);
    plexFake();
    const result = await searchPlexLibrary({ title: "movie", limit: 500 });
    assert.equal(titles(result).length, 500);
    assert.match(textOf(result), /600 matching movies, listed 1-500\. 100 more are not listed: call again with offset 500/);
    assert.equal(titles(await searchPlexLibrary({ title: "movie", limit: 9999 })).length, 500);
  });

  it("pages through a merged result with offset, without gaps or repeats", async () => {
    library["1"] = many(150).filter((_, i) => i % 2 === 0); // even-numbered titles
    library["2"] = many(150).filter((_, i) => i % 2 === 1); // odd-numbered titles
    plexFake();
    const first = await searchPlexLibrary({ title: "m", limit: 60 });
    const second = await searchPlexLibrary({ title: "m", limit: 60, offset: 60 });
    const third = await searchPlexLibrary({ title: "m", limit: 60, offset: 120 });
    assert.deepEqual([...titles(first), ...titles(second), ...titles(third)], many(150).map((m) => m.title), "every title exactly once, in order");
    assert.match(textOf(first), /offset 60/);
    assert.match(textOf(second), /listed 61-120/);
    assert.match(textOf(second), /offset 120/);
    assert.doesNotMatch(textOf(third), /call again with offset/);
  });

  it("counts and pages by movie, not by library entry", async () => {
    library["1"] = many(10);
    library["2"] = many(10); // the same ten movies again, in the other library
    plexFake();
    const result = await searchPlexLibrary({ title: "m", limit: 4 });
    assert.match(textOf(result), /10 matching movies, listed 1-4\./, "10 movies, not 20 entries");
    assert.deepEqual(titles(await searchPlexLibrary({ title: "m", limit: 4, offset: 8 })), ["Movie 008", "Movie 009"]);
  });

  it("flags continuation pages so the UI appends them, and fresh searches so it replaces", async () => {
    library["1"] = many(30);
    plexFake();
    assert.equal(((await searchPlexLibrary({ title: "m", limit: 10 })) as any).structuredContent.append, false);
    assert.equal(((await searchPlexLibrary({ title: "m", limit: 10, offset: 10 })) as any).structuredContent.append, true);
  });

  it("says so when the offset is past the end", async () => {
    library["1"] = many(5);
    plexFake();
    const result = await searchPlexLibrary({ title: "m", offset: 50 });
    assert.match(textOf(result), /Offset 50 is past the end: there are only 5 matching movies/);
    assert.equal((result as any).structuredContent, undefined);
  });

  it("treats a negative offset as 0", async () => {
    library["1"] = many(3);
    plexFake();
    assert.equal(titles(await searchPlexLibrary({ title: "m", offset: -5 })).length, 3);
  });
});

describe("searchPlexLibrary: TV shows", () => {
  const rowsOf = (r: any) => r.structuredContent.media as any[];
  const bullets = (r: { content: Array<{ text: string }> }) => textOf(r).split("\n").filter((l) => l.startsWith("- "));
  const urls = () => allCalls().map((c) => c.url).sort();

  it("mediaType show searches only show libraries; any searches both kinds", async () => {
    plexFake();
    await searchPlexLibrary({ title: "x", mediaType: "show" });
    assert.deepEqual(urls(), ["/library/sections/3/all", "/library/sections/4/all", "/library/sections/5/all"]);
    fake.calls.length = 0;
    await searchPlexLibrary({ title: "x" });
    assert.equal(allCalls().length, 5, "movie libraries and show libraries");
    fake.calls.length = 0;
    await searchPlexLibrary({ title: "x", mediaType: "any" });
    assert.equal(allCalls().length, 5);
  });

  it("mediaType alone is enough to list shows, but 'any' alone is still not a search", async () => {
    library["3"] = [show("Severance", 2022)];
    plexFake();
    const shows = await searchPlexLibrary({ mediaType: "show" });
    assert.equal(shows.isError, undefined);
    assert.deepEqual(rowsOf(shows).map((r) => r.title), ["Severance"]);
    const none = await searchPlexLibrary({ mediaType: "any" });
    assert.equal(none.isError, true);
    assert.match(textOf(none), /Provide at least one of/);
  });

  it("describes a show with seasons, episodes, watch progress and network", async () => {
    library["3"] = [show("Severance", 2022)];
    plexFake();
    const result = await searchPlexLibrary({ title: "sever", mediaType: "show" });
    assert.deepEqual(rowsOf(result), [
      {
        kind: "show",
        title: "Severance",
        year: 2022,
        posterUrl: "/api/plex/image?path=%2Flibrary%2Fmetadata%2F2022%2Fthumb%2F2",
        libraries: ["TV Shows"],
        genres: ["Drama"],
        rating: 8.6,
        detail: null,
        show: { seasons: 5, episodes: 62, watchedEpisodes: 40, network: "HBO" },
      },
    ]);
    assert.deepEqual(bullets(result), ["- Severance (2022) - TV show, 5 seasons, 62 episodes (40 watched), TV Shows - Drama"]);
    assert.match(textOf(result), /1 matching show\./);
  });

  it("treats a show Plex reports no watched count for as unwatched, and copes with missing counts", async () => {
    library["3"] = [
      show("Fresh", 2024, { viewedLeafCount: undefined, childCount: 1, leafCount: 1 }),
      show("Bare", 2020, { childCount: undefined, leafCount: undefined, viewedLeafCount: undefined, studio: undefined, Guid: undefined }),
    ];
    plexFake();
    const result = await searchPlexLibrary({ mediaType: "show" });
    const [bare, fresh] = rowsOf(result);
    assert.deepEqual(fresh.show, { seasons: 1, episodes: 1, watchedEpisodes: 0, network: "HBO" });
    assert.deepEqual(bare.show, { seasons: null, episodes: null, watchedEpisodes: 0, network: null });
    assert.deepEqual(bullets(result), ["- Bare (2020) - TV show, size unknown, TV Shows - Drama", "- Fresh (2024) - TV show, 1 season, 1 episode (0 watched), TV Shows - Drama"]);
  });

  it("makes a show held in HD and 4K libraries ONE entry with both libraries", async () => {
    library["3"] = [show("Andor", 2022)];
    library["4"] = [show("Andor", 2022)];
    plexFake();
    const result = await searchPlexLibrary({ title: "andor", mediaType: "show" });
    assert.deepEqual(rowsOf(result).map((r) => [r.title, r.libraries]), [["Andor", ["TV Shows", "4k TV Shows"]]]);
    assert.match(textOf(result), /1 matching show\./);
  });

  it("groups by TMDb id first, and falls back to TVDB for a copy Plex matched only there", async () => {
    // Same show: HD matched to TMDb + TVDB, 4K matched to TVDB alone.
    library["3"] = [show("The Wire", 2002, { Guid: [{ id: "tmdb://1438" }, { id: "tvdb://79126" }] })];
    library["4"] = [show("The Wire", 2002, { Guid: [{ id: "tvdb://79126" }] })];
    plexFake();
    const rows = rowsOf(await searchPlexLibrary({ title: "wire", mediaType: "show" }));
    assert.deepEqual(rows.map((r) => r.libraries), [["TV Shows", "4k TV Shows"]]);
  });

  it("groups shows by TVDB alone when Plex has no TMDb match at all", async () => {
    library["3"] = [show("Obscure", 2015, { Guid: [{ id: "tvdb://555" }] })];
    library["4"] = [show("Obscure", 2015, { Guid: [{ id: "tvdb://555" }] })];
    plexFake();
    const rows = rowsOf(await searchPlexLibrary({ title: "obscure", mediaType: "show" }));
    assert.deepEqual(rows.map((r) => r.libraries), [["TV Shows", "4k TV Shows"]]);
  });

  it("does not merge a TMDb number with the same TVDB number: they are different id spaces", async () => {
    library["3"] = [show("Has TMDb 5", 2001, { Guid: [{ id: "tmdb://5" }] })];
    library["4"] = [show("Has TVDB 5", 2002, { Guid: [{ id: "tvdb://5" }] })];
    plexFake();
    const rows = rowsOf(await searchPlexLibrary({ mediaType: "show" }));
    assert.deepEqual(rows.map((r) => [r.title, r.libraries]), [["Has TMDb 5", ["TV Shows"]], ["Has TVDB 5", ["4k TV Shows"]]]);
  });

  it("does not merge a movie and a show that share a TMDb number", async () => {
    // TMDb numbers are separate for movies and TV, so 1399 is two different things.
    library["1"] = [movie("Movie 1399", 2001, { Guid: [{ id: "tmdb://1399" }] })];
    library["3"] = [show("Show 1399", 2002, { Guid: [{ id: "tmdb://1399" }] })];
    plexFake();
    const result = await searchPlexLibrary({ title: "1399" });
    assert.deepEqual(rowsOf(result).map((r) => [r.kind, r.title, r.libraries]), [["movie", "Movie 1399", ["Movies"]], ["show", "Show 1399", ["TV Shows"]]]);
  });

  it("returns movies and shows together with a count of each", async () => {
    library["1"] = [movie("Fargo", 1996)];
    library["3"] = [show("Fargo", 2014)];
    library["4"] = [show("Fargo", 2014)];
    plexFake();
    const result = await searchPlexLibrary({ title: "fargo" });
    assert.match(textOf(result), /2 matching titles \(1 movie, 1 show\)\./);
    assert.deepEqual(rowsOf(result).map((r) => [r.kind, r.year]), [["movie", 1996], ["show", 2014]]);
    assert.match(textOf(result), /each line is one title/i);
  });

  it("passes genre, actor and year filters to show libraries too", async () => {
    hubActors = [{ id: 7, tag: "Bryan Cranston" }];
    plexFake();
    await searchPlexLibrary({ genre: "Drama", actor: "Bryan Cranston", year: 2008, mediaType: "show" });
    for (const call of allCalls()) {
      assert.equal(call.params.genre, "999");
      assert.equal(call.params.actor, "7");
      assert.equal(call.params.year, 2008);
    }
    assert.equal(allCalls().length, 3);
  });

  it("pages shows exactly as it pages movies", async () => {
    library["3"] = Array.from({ length: 30 }, (_, i) => show(`Show ${String(i).padStart(2, "0")}`, 2000, { Guid: [{ id: `tmdb://${i}` }] }));
    plexFake();
    const first = await searchPlexLibrary({ mediaType: "show", limit: 10 });
    const second = await searchPlexLibrary({ mediaType: "show", limit: 10, offset: 10 });
    assert.match(textOf(first), /30 matching shows, listed 1-10\. 20 more are not listed: call again with offset 10/);
    assert.equal((first as any).structuredContent.append, false);
    assert.equal((second as any).structuredContent.append, true);
    assert.deepEqual(rowsOf(second).map((r) => r.title).slice(0, 2), ["Show 10", "Show 11"]);
    assert.match(textOf(await searchPlexLibrary({ mediaType: "show", offset: 99 })), /Offset 99 is past the end: there are only 30 matching shows/);
  });
});

describe("searchPlexLibrary: libraries left out by default", () => {
  const urls = () => allCalls().map((c) => c.url).sort();
  const rowsOf = (r: any) => r.structuredContent.media as any[];

  it("searches every show library when nothing is set to be left out", async () => {
    plexFake();
    await searchPlexLibrary({ title: "x", mediaType: "show" });
    assert.deepEqual(urls(), ["/library/sections/3/all", "/library/sections/4/all", "/library/sections/5/all"]);
  });

  it("leaves out libraries named in the setting (whole names, any case, spaces and stray commas ignored)", async () => {
    setSetting("PLEX_SKIP_LIBRARIES", "  sPoRtS , ,");
    plexFake();
    await searchPlexLibrary({ title: "x", mediaType: "show" });
    assert.deepEqual(urls(), ["/library/sections/3/all", "/library/sections/4/all"]);
    fake.calls.length = 0;
    await searchPlexLibrary({ title: "x" });
    assert.equal(allCalls().length, 4, "movies + the two shown show libraries");
  });

  it("matches whole names only, so 'sport' does not leave out 'Sports'", async () => {
    setSetting("PLEX_SKIP_LIBRARIES", "sport");
    plexFake();
    await searchPlexLibrary({ title: "x", mediaType: "show" });
    assert.equal(allCalls().length, 3);
  });

  it("can leave out several libraries, including movie ones", async () => {
    setSetting("PLEX_SKIP_LIBRARIES", "Sports, 4k Movies");
    plexFake();
    await searchPlexLibrary({ title: "x" });
    assert.deepEqual(urls(), ["/library/sections/1/all", "/library/sections/3/all", "/library/sections/4/all"]);
  });

  it("still searches a skipped library when the library filter names it", async () => {
    setSetting("PLEX_SKIP_LIBRARIES", "Sports");
    library["5"] = [show("Formula 1: Drive to Survive", 2019, { Guid: [{ id: "tmdb://74" }] })];
    plexFake();
    const result = await searchPlexLibrary({ title: "formula", library: "sports" });
    assert.deepEqual(urls(), ["/library/sections/5/all"]);
    assert.deepEqual(rowsOf(result).map((r) => r.libraries), [["Sports"]]);
  });

  it("does not hide the skipped library's titles from a title that is also elsewhere", async () => {
    setSetting("PLEX_SKIP_LIBRARIES", "Sports");
    library["3"] = [show("Same", 2010, { Guid: [{ id: "tmdb://9" }] })];
    library["5"] = [show("Same", 2010, { Guid: [{ id: "tmdb://9" }] })];
    plexFake();
    const rows = rowsOf(await searchPlexLibrary({ title: "same", mediaType: "show" }));
    assert.deepEqual(rows.map((r) => r.libraries), [["TV Shows"]], "the Sports copy is not searched by default");
  });

  it("says how to get at libraries when every one of the searched kind is left out", async () => {
    setSetting("PLEX_SKIP_LIBRARIES", "TV Shows, 4k TV Shows, Sports");
    plexFake();
    const result = await searchPlexLibrary({ title: "x", mediaType: "show" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Every show library is skipped by default.*Name one with the library filter: TV Shows, 4k TV Shows, Sports\./);
    assert.equal(allCalls().length, 0);
  });
});

describe("getOwnedTmdbIndex", () => {
  it("maps TMDb ids to every library that holds the movie, skipping items without one", async () => {
    library["1"] = [movie("Heat", 1995), { title: "No Guid" }];
    library["2"] = [movie("Heat", 1995)];
    plexFake();
    const index = await getOwnedTmdbIndex();
    assert.deepEqual([...index.entries()], [["1995", ["Movies", "4k Movies"]]]);
  });

  it("pages through large libraries", async () => {
    library["1"] = Array.from({ length: 2500 }, (_, i) => movie(`M${i}`, 1000 + i, { Guid: [{ id: `tmdb://${i}` }] }));
    plexFake();
    const index = await getOwnedTmdbIndex();
    assert.equal(index.size, 2500);
    assert.equal(fake.calls.filter((c) => c.url === "/library/sections/1/all").length, 3);
  });

  it("caches the index until it's reset", async () => {
    library["1"] = [movie("Heat", 1995)];
    plexFake();
    await getOwnedTmdbIndex();
    const callsAfterFirst = fake.calls.length;
    await getOwnedTmdbIndex();
    assert.equal(fake.calls.length, callsAfterFirst, "second call is served from the cache");
    resetOwnedTmdbIndexCache();
    await getOwnedTmdbIndex();
    assert.ok(fake.calls.length > callsAfterFirst);
  });
});
