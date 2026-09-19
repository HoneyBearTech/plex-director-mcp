import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plexClient } from "../src/clients.js";
import { getOnDeck, getOwnedTmdbIndex, resetOwnedTmdbIndexCache, searchPlexLibrary } from "../src/tools/plex.js";
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

describe("searchPlexLibrary: watch state", () => {
  // Saturday 2026-09-19 15:00 UTC.
  const NOW = Date.parse("2026-09-19T15:00:00Z");
  const at = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);
  const rowsOf = (r: any) => (r.structuredContent?.media ?? []) as any[];
  const titlesOf = (r: any) => rowsOf(r).map((m) => m.title);
  const bullets = (r: { content: Array<{ text: string }> }) => textOf(r).split("\n").filter((l) => l.startsWith("- "));
  // A movie / show with its own ids, so nothing groups by accident.
  const m = (n: number, title: string, extra: Record<string, unknown> = {}) => movie(title, 2000 + (n % 20), { Guid: [{ id: `tmdb://${n}` }], ...extra });
  const sh = (n: number, title: string, extra: Record<string, unknown> = {}) => show(title, 2000 + (n % 20), { Guid: [{ id: `tmdb://${n}` }], ...extra });
  const search = (args: Parameters<typeof searchPlexLibrary>[0]) => searchPlexLibrary(args, NOW);

  describe("the watched filter", () => {
    it("finds movies never played, ignoring ones watched or partly watched", async () => {
      library["1"] = [
        m(1, "Never Seen"),
        m(2, "Seen Once", { viewCount: 1, lastViewedAt: at("2025-06-01") }),
        m(3, "Half Way", { viewOffset: 1000, duration: 4000, lastViewedAt: at("2026-02-21") }),
        m(4, "Zero Count", { viewCount: 0 }),
      ];
      plexFake();
      assert.deepEqual(titlesOf(await search({ watched: "unwatched", mediaType: "movie" })), ["Never Seen", "Zero Count"]);
    });

    it("finds movies in progress (partly played), and movies watched at least once", async () => {
      library["1"] = [
        m(1, "Never Seen"),
        m(2, "Seen Once", { viewCount: 1, lastViewedAt: at("2025-06-01") }),
        m(3, "Half Way", { viewOffset: 1000, duration: 4000, lastViewedAt: at("2026-02-21") }),
        m(4, "Rewatching", { viewCount: 2, viewOffset: 500, lastViewedAt: at("2026-09-01") }),
      ];
      plexFake();
      assert.deepEqual(titlesOf(await search({ watched: "inProgress", mediaType: "movie" })), ["Half Way", "Rewatching"]);
      assert.deepEqual(titlesOf(await search({ watched: "watched", mediaType: "movie" })), ["Rewatching", "Seen Once"], "a movie being rewatched has still been watched");
    });

    it("finds shows with no episodes watched, some but not all, or all", async () => {
      library["3"] = [
        sh(1, "Fresh", { viewedLeafCount: undefined }),
        sh(2, "Zero", { viewedLeafCount: 0 }),
        sh(3, "Midway", { leafCount: 10, viewedLeafCount: 4, lastViewedAt: at("2026-07-17") }),
        sh(4, "All Done", { leafCount: 10, viewedLeafCount: 10, lastViewedAt: at("2025-01-01") }),
        sh(5, "Empty Show", { leafCount: 0, viewedLeafCount: 0 }),
      ];
      plexFake();
      assert.deepEqual(titlesOf(await search({ watched: "unwatched", mediaType: "show" })), ["Empty Show", "Fresh", "Zero"]);
      assert.deepEqual(titlesOf(await search({ watched: "inProgress", mediaType: "show" })), ["Midway"]);
      assert.deepEqual(titlesOf(await search({ watched: "watched", mediaType: "show" })), ["All Done"]);
    });

    it("judges a show held in two libraries by its furthest-watched copy", async () => {
      library["3"] = [sh(1, "Andor", { leafCount: 24, viewedLeafCount: 0 })];
      library["4"] = [sh(1, "Andor", { leafCount: 24, viewedLeafCount: 10, lastViewedAt: at("2026-08-01") })];
      plexFake();
      assert.deepEqual(titlesOf(await search({ watched: "unwatched", mediaType: "show" })), [], "watched in 4K, so not unwatched");
      const result = await search({ watched: "inProgress", mediaType: "show" });
      assert.deepEqual(rowsOf(result).map((r) => [r.title, r.libraries, r.show.watchedEpisodes, r.show.episodes, r.lastWatched]), [["Andor", ["TV Shows", "4k TV Shows"], 10, 24, "2026-08-01"]]);
      assert.match(bullets(result)[0]!, /24 episodes \(10 watched\)/);
    });

    it("takes the most recent watch date across copies, and counts a movie watched in either copy as watched", async () => {
      library["3"] = [sh(1, "Andor", { leafCount: 24, viewedLeafCount: 10, lastViewedAt: at("2026-01-01") })];
      library["4"] = [sh(1, "Andor", { leafCount: 24, viewedLeafCount: 10, lastViewedAt: at("2026-08-01") })];
      library["1"] = [m(10, "Two Copies", { viewCount: 0 })];
      library["2"] = [m(10, "Two Copies", { viewCount: 2, lastViewedAt: at("2026-03-03") })];
      plexFake();
      assert.equal(rowsOf(await search({ watched: "inProgress", mediaType: "show" }))[0].lastWatched, "2026-08-01", "the later of the two dates");
      assert.deepEqual(titlesOf(await search({ watched: "watched", mediaType: "movie" })), ["Two Copies"]);
      assert.deepEqual(titlesOf(await search({ watched: "unwatched", mediaType: "movie" })), [], "watched in the 4K copy, so not unwatched");
    });

    it("combines with the other filters and applies before paging", async () => {
      library["1"] = [...Array.from({ length: 60 }, (_, i) => m(100 + i, `Unseen ${String(i).padStart(2, "0")}`)), ...Array.from({ length: 10 }, (_, i) => m(200 + i, `Seen ${i}`, { viewCount: 1, lastViewedAt: at("2025-01-01") }))];
      plexFake();
      const result = await search({ watched: "unwatched", mediaType: "movie", genre: "Horror", library: "movies", limit: 10 });
      assert.match(textOf(result), /60 matching movies, listed 1-10\./);
      assert.equal(allCalls()[0]!.params.genre, "930");
      assert.match(textOf(result), /## Plex library: unwatched, in "Movies", "4k Movies", genre "Horror"/);
      const page2 = await search({ watched: "unwatched", mediaType: "movie", limit: 10, offset: 55 });
      assert.deepEqual(titlesOf(page2), ["Unseen 55", "Unseen 56", "Unseen 57", "Unseen 58", "Unseen 59"]);
    });

    it("says whose watch state it is", async () => {
      library["1"] = [m(1, "Never Seen")];
      plexFake();
      assert.match(textOf(await search({ watched: "unwatched" })), /Watch state is for the Plex account the app is connected with\./);
      assert.doesNotMatch(textOf(await search({ title: "never" })), /Watch state/);
    });

    it("is enough on its own to make a search, as is a sort, but the default sort alone is not", async () => {
      plexFake();
      assert.equal((await search({ watched: "unwatched" })).isError, undefined);
      assert.equal((await search({ sort: "recentlyAdded" })).isError, undefined);
      const none = await search({ sort: "title" });
      assert.equal(none.isError, true);
      assert.match(textOf(none), /Provide at least one of: .*watched, notWatchedInYears, sort/);
    });
  });

  describe("notWatchedInYears", () => {
    it("finds movies last watched longer ago than that, and never-watched ones added that long ago", async () => {
      library["1"] = [
        m(1, "Watched Long Ago", { viewCount: 1, lastViewedAt: at("2023-01-10") }),
        m(2, "Watched Last Year", { viewCount: 1, lastViewedAt: at("2025-06-01") }),
        m(3, "Old Unseen", { addedAt: at("2022-05-01") }),
        m(4, "Recent Unseen", { addedAt: at("2026-03-01") }),
        m(5, "Old But Rewatched Lately", { viewCount: 3, lastViewedAt: at("2026-09-01"), addedAt: at("2019-01-01") }),
      ];
      plexFake();
      assert.deepEqual(titlesOf(await search({ notWatchedInYears: 2, mediaType: "movie" })), ["Old Unseen", "Watched Long Ago"]);
      assert.deepEqual(titlesOf(await search({ notWatchedInYears: 1, mediaType: "movie" })), ["Old Unseen", "Watched Last Year", "Watched Long Ago"]);
      assert.deepEqual(titlesOf(await search({ notWatchedInYears: 0.5, mediaType: "movie" })), ["Old Unseen", "Recent Unseen", "Watched Last Year", "Watched Long Ago"], "fractions of a year work");
    });

    it("uses when a show was last watched, or when it was added if it never was", async () => {
      library["3"] = [
        sh(1, "Stale Show", { leafCount: 10, viewedLeafCount: 3, lastViewedAt: at("2022-02-02") }),
        sh(2, "Active Show", { leafCount: 10, viewedLeafCount: 3, lastViewedAt: at("2026-09-01") }),
        sh(3, "Unwatched Old", { viewedLeafCount: 0, addedAt: at("2021-01-01") }),
        sh(4, "Unwatched New", { viewedLeafCount: 0, addedAt: at("2026-08-01") }),
      ];
      plexFake();
      assert.deepEqual(titlesOf(await search({ notWatchedInYears: 2, mediaType: "show" })), ["Stale Show", "Unwatched Old"]);
    });

    it("leaves out, and says so for, titles Plex says were watched but holds no date for", async () => {
      library["3"] = [
        sh(1, "Stale Show", { leafCount: 10, viewedLeafCount: 3, lastViewedAt: at("2022-02-02") }),
        sh(2, "Watched No Date", { leafCount: 10, viewedLeafCount: 5, addedAt: at("2019-01-01") }),
        sh(3, "Also No Date", { leafCount: 10, viewedLeafCount: 5 }),
      ];
      plexFake();
      const result = await search({ notWatchedInYears: 2, mediaType: "show" });
      assert.deepEqual(titlesOf(result), ["Stale Show"]);
      assert.match(textOf(result), /2 titles have been watched but Plex holds no date for them, so they were left out of the "not watched in 2 years" list because that can't be judged\./);
      // Even when nothing else is left, the reply must still explain the ones that were skipped.
      library["3"] = [sh(1, "Watched No Date", { leafCount: 10, viewedLeafCount: 5 })];
      const empty = textOf(await search({ notWatchedInYears: 2, mediaType: "show" }));
      assert.match(empty, /^No shows in Plex match not watched in 2 years\. 1 title has been watched but Plex holds no date for it, so it was left out of the "not watched in 2 years" list because that can't be judged\.$/);
    });

    it("treats a title with nothing dated at all as unknown, not stale", async () => {
      library["1"] = [m(1, "No Dates At All")];
      plexFake();
      assert.match(textOf(await search({ notWatchedInYears: 1, mediaType: "movie" })), /No movies in Plex match/);
    });

    it("counts from when it was first added when a title is in two libraries", async () => {
      library["1"] = [m(1, "Upgraded", { addedAt: at("2020-01-01") })];
      library["2"] = [m(1, "Upgraded", { addedAt: at("2026-09-01") })];
      plexFake();
      assert.deepEqual(titlesOf(await search({ notWatchedInYears: 3, mediaType: "movie" })), ["Upgraded"], "first added 2020, never watched since");
    });

    it("rejects a period that is not a positive number", async () => {
      plexFake();
      for (const bad of [0, -1, Number.NaN]) {
        const result = await search({ notWatchedInYears: bad });
        assert.equal(result.isError, true, String(bad));
        assert.match(textOf(result), /notWatchedInYears must be greater than 0/);
      }
      assert.equal(allCalls().length, 0);
    });

    it("says what was asked in the heading", async () => {
      library["1"] = [m(1, "Old", { addedAt: at("2020-01-01") })];
      plexFake();
      assert.match(textOf(await search({ notWatchedInYears: 2 })), /## Plex library: not watched in 2 years\n/);
      assert.match(textOf(await search({ notWatchedInYears: 1 })), /not watched in 1 year\n/);
    });
  });

  describe("sort", () => {
    beforeEach(() => {
      library["1"] = [
        m(1, "Charlie", { addedAt: at("2024-01-01"), viewCount: 1, lastViewedAt: at("2025-05-05") }),
        m(2, "Alpha", { addedAt: at("2026-08-01") }),
        m(3, "Bravo", { addedAt: at("2023-03-03"), viewCount: 1, lastViewedAt: at("2026-01-01") }),
        m(4, "Delta", { addedAt: at("2022-02-02") }),
        m(5, "Echo", { viewCount: 1 }),
      ];
    });

    it("names the ordering in the heading when nothing else is asked", async () => {
      plexFake();
      assert.match(textOf(await search({ sort: "recentlyAdded" })), /^## Plex library: newest additions first\n/);
      assert.match(textOf(await search({ sort: "lastWatched" })), /^## Plex library: most recently watched first\n/);
      assert.match(textOf(await search({ sort: "leastRecentlyWatched" })), /^## Plex library: longest unwatched first\n/);
      assert.match(textOf(await search({ sort: "recentlyAdded", watched: "unwatched" })), /^## Plex library: unwatched\n/, "a real filter is described instead");
    });

    it("sorts by title by default", async () => {
      plexFake();
      assert.deepEqual(titlesOf(await search({ mediaType: "movie", library: "movies" })), ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    });

    it("recentlyAdded lists the newest additions first, using the latest add date across libraries", async () => {
      library["2"] = [m(4, "Delta", { addedAt: at("2026-09-10") })];
      plexFake();
      assert.deepEqual(titlesOf(await search({ mediaType: "movie", sort: "recentlyAdded" })), ["Delta", "Alpha", "Charlie", "Bravo", "Echo"], "Delta was re-added to 4K last week; Echo has no date so is last");
    });

    it("lastWatched lists the most recently watched first, with never-watched titles last", async () => {
      plexFake();
      assert.deepEqual(titlesOf(await search({ mediaType: "movie", sort: "lastWatched" })), ["Bravo", "Charlie", "Alpha", "Delta", "Echo"]);
    });

    it("leastRecentlyWatched lists the longest-idle first: last watched, or added if never watched; unknown last", async () => {
      plexFake();
      assert.deepEqual(titlesOf(await search({ mediaType: "movie", sort: "leastRecentlyWatched" })), ["Delta", "Charlie", "Bravo", "Alpha", "Echo"]);
    });

    it("keeps a stable title order among equal dates", async () => {
      library["1"] = [m(1, "Zed", { addedAt: at("2025-01-01") }), m(2, "Abe", { addedAt: at("2025-01-01") })];
      plexFake();
      assert.deepEqual(titlesOf(await search({ mediaType: "movie", sort: "recentlyAdded" })), ["Abe", "Zed"]);
    });

    it("sorts before paging", async () => {
      plexFake();
      const first = await search({ mediaType: "movie", sort: "recentlyAdded", limit: 2 });
      const second = await search({ mediaType: "movie", sort: "recentlyAdded", limit: 2, offset: 2 });
      assert.deepEqual([...titlesOf(first), ...titlesOf(second)], ["Alpha", "Charlie", "Bravo", "Delta"]);
    });
  });

  describe("dates on rows and in the text", () => {
    it("adds last-watched and added dates to rows only for watch or sort queries", async () => {
      library["1"] = [m(1, "Plain", { viewCount: 1, lastViewedAt: at("2026-02-21"), addedAt: at("2024-11-16") })];
      plexFake();
      const plain = rowsOf(await search({ title: "plain" }))[0];
      assert.equal("lastWatched" in plain, false);
      assert.equal("added" in plain, false);
      const withDates = rowsOf(await search({ title: "plain", sort: "recentlyAdded" }))[0];
      assert.deepEqual([withDates.lastWatched, withDates.added], ["2026-02-21", "2024-11-16"]);
    });

    it("says never (null), a date, or that the date is unknown", async () => {
      library["1"] = [m(1, "Never"), m(2, "Dated", { viewCount: 1, lastViewedAt: at("2026-02-21") }), m(3, "Undated", { viewCount: 1 })];
      library["3"] = [sh(4, "Show Undated", { leafCount: 10, viewedLeafCount: 3 })];
      plexFake();
      const byTitle = Object.fromEntries(rowsOf(await search({ sort: "lastWatched" })).map((r) => [r.title, r.lastWatched]));
      assert.deepEqual(byTitle, { Never: null, Dated: "2026-02-21", Undated: "date unknown", "Show Undated": "date unknown" });
    });

    it("describes each title's watch state in the model's list", async () => {
      library["1"] = [
        m(1, "Never"),
        m(2, "Dated", { viewCount: 1, lastViewedAt: at("2026-02-21"), addedAt: at("2024-11-16") }),
        m(3, "Undated", { viewCount: 1 }),
        m(4, "Halfway", { viewOffset: 1355406, duration: 6906912, lastViewedAt: at("2026-02-21") }),
        m(5, "Halfway Undated", { viewOffset: 100 }),
      ];
      library["3"] = [sh(6, "Started", { leafCount: 30, viewedLeafCount: 23, lastViewedAt: at("2026-07-17") }), sh(7, "Fresh", { viewedLeafCount: undefined })];
      plexFake();
      const out = bullets(await search({ sort: "lastWatched" }));
      const line = (t: string) => out.find((l) => l.startsWith(`- ${t} (`))!;
      assert.match(line("Never"), / - unwatched$/);
      assert.match(line("Dated"), / - watched 2026-02-21$/);
      assert.match(line("Undated"), / - watched, date unknown$/);
      assert.match(line("Halfway"), / - in progress \(20%\), last watched 2026-02-21$/);
      assert.match(line("Halfway Undated"), / - in progress$/);
      assert.match(line("Started"), /TV show, 5 seasons, 30 episodes \(23 watched\), TV Shows - Drama - last watched 2026-07-17$/);
      assert.match(line("Fresh"), / - unwatched$/);
      const added = bullets(await search({ sort: "recentlyAdded", title: "dated" }));
      assert.match(added.find((l) => l.startsWith("- Dated"))!, / - watched 2026-02-21, added 2024-11-16$/);
    });
  });
});

describe("getOnDeck", () => {
  const at = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);
  let deck: any[];
  const deckFake = (overrides?: (req: RecordedRequest) => any) =>
    plexFake((req) => overrides?.(req) ?? (req.url === "/library/onDeck" ? { data: { MediaContainer: { size: deck.length, Metadata: deck } } } : undefined));

  const episode = (show: string, season: number, number: number, title: string, extra: Record<string, unknown> = {}) => ({
    type: "episode",
    title,
    grandparentTitle: show,
    grandparentGuid: `plex://show/${show}`,
    parentIndex: season,
    index: number,
    librarySectionTitle: "TV Shows",
    viewOffset: 1_643_463,
    duration: 2_862_900,
    lastViewedAt: at("2026-09-19"),
    year: 2026,
    thumb: `/library/metadata/${number}/thumb/1`,
    grandparentThumb: `/library/metadata/${show.length}/thumb/9`,
    ...extra,
  });
  const film = (title: string, year: number, extra: Record<string, unknown> = {}) => ({
    type: "movie",
    title,
    year,
    guid: `plex://movie/${title}`,
    librarySectionTitle: "Movies",
    viewOffset: 4_793_507,
    duration: 6_859_136,
    lastViewedAt: at("2026-09-16"),
    thumb: `/library/metadata/${year}/thumb/3`,
    ...extra,
  });
  const lines = (r: any) => textOf(r).split("\n").filter((l) => l.startsWith("- "));
  const rows = (r: any) => (r.structuredContent?.media ?? []) as any[];
  const titles = (r: any) => rows(r).map((m) => m.title);

  beforeEach(() => {
    deck = [];
  });

  it("lists episodes and movies in Plex's order, saying how far through each one is", async () => {
    deck = [episode("Ted Lasso", 4, 5, "Riches of Embarrassment"), film("Scream", 2022), episode("Lioness", 3, 2, "No Sorrow Like the Survivor", { viewOffset: 609_874, duration: 3_162_451, lastViewedAt: at("2026-09-17") })];
    deckFake();
    const result = await getOnDeck();
    assert.match(textOf(result), /^## On deck in Plex \(the "continue watching" list\): 3 items\n/);
    assert.deepEqual(lines(result), [
      '- Ted Lasso S4E05 "Riches of Embarrassment" - TV Shows - 57% watched, last watched 2026-09-19',
      "- Scream (2022) - Movies - 70% watched, last watched 2026-09-16",
      '- Lioness S3E02 "No Sorrow Like the Survivor" - TV Shows - 19% watched, last watched 2026-09-17',
    ]);
    assert.match(textOf(result), /Watch state is for the Plex account the app is connected with\./);
  });

  it("asks Plex for up to 50 items", async () => {
    deckFake();
    await getOnDeck();
    assert.equal(fake.calls[0]!.params["X-Plex-Container-Size"], 50);
  });

  it("calls an episode nothing has been played of 'next up', with the last activity date", async () => {
    deck = [episode("Dark Matter (2024)", 2, 1, "A Quiet Life", { viewOffset: undefined, lastViewedAt: at("2026-08-28") })];
    deckFake();
    const result = await getOnDeck();
    assert.deepEqual(lines(result), ['- Dark Matter (2024) S2E01 "A Quiet Life" - TV Shows - next up, last activity 2026-08-28']);
    assert.equal(rows(result)[0].lastWatched, undefined, "a next-up episode has not been watched, so no 'last watched' cell");
  });

  it("copes with a next-up episode with no dates, and a movie with no duration or year", async () => {
    deck = [episode("Bare Show", 1, 1, "", { viewOffset: undefined, lastViewedAt: undefined }), film("Mystery", 0, { duration: undefined, year: undefined })];
    deckFake();
    const result = await getOnDeck();
    assert.deepEqual(lines(result), ["- Bare Show S1E01 - TV Shows - next up", "- Mystery - Movies - partly watched, last watched 2026-09-16"]);
  });

  it("never reports 100% for something not finished", async () => {
    deck = [film("Nearly", 2020, { viewOffset: 6_850_000, duration: 6_859_136 }), film("Over", 2021, { viewOffset: 9_000_000, duration: 6_859_136 })];
    deckFake();
    assert.deepEqual(lines(await getOnDeck()).map((l) => l.split(" - ").pop()!.split(",")[0]), ["99% watched", "99% watched"]);
  });

  it("shows a movie held in HD and 4K once, listing both libraries", async () => {
    deck = [film("F1: The Movie", 2025, { librarySectionTitle: "4k Movies" }), film("Scream", 2022), film("F1: The Movie", 2025, { librarySectionTitle: "Movies", viewOffset: 100 })];
    deckFake();
    const result = await getOnDeck();
    assert.deepEqual(titles(result), ["F1: The Movie", "Scream"]);
    assert.deepEqual(rows(result)[0].libraries, ["4k Movies", "Movies"]);
    assert.match(lines(result)[0]!, /^- F1: The Movie \(2025\) - 4k Movies, Movies - 70% watched/, "the first (most recent) entry's progress is the one shown, not the later copy's 1%");
  });

  it("shows a show held in two libraries once, and tells same-titled shows apart by their Plex id", async () => {
    deck = [
      episode("Andor", 2, 3, "Ep", { librarySectionTitle: "4k TV Shows" }),
      episode("Andor", 2, 3, "Ep", { librarySectionTitle: "TV Shows" }),
      episode("Fargo", 3, 1, "Old Fargo", { grandparentGuid: "plex://show/fargo-1996" }),
      episode("Fargo", 1, 1, "New Fargo", { grandparentGuid: "plex://show/fargo-2014" }),
    ];
    deckFake();
    const result = await getOnDeck();
    assert.deepEqual(rows(result).map((r) => [r.title, r.libraries]), [["Andor", ["4k TV Shows", "TV Shows"]], ["Fargo", ["TV Shows"]], ["Fargo", ["TV Shows"]]]);
  });

  it("falls back to the title when Plex gives no guid", async () => {
    deck = [film("No Guid", 2020, { guid: undefined, librarySectionTitle: "Movies" }), film("No Guid", 2020, { guid: undefined, librarySectionTitle: "4k Movies" }), episode("Guidless", 1, 1, "x", { grandparentGuid: undefined }), episode("Guidless", 1, 1, "x", { grandparentGuid: undefined, librarySectionTitle: "Kid's TV Shows" })];
    deckFake();
    assert.deepEqual(rows(await getOnDeck()).map((r) => [r.title, r.libraries]), [["No Guid", ["Movies", "4k Movies"]], ["Guidless", ["TV Shows", "Kid's TV Shows"]]]);
  });

  it("does not merge different movies just because Plex gives them no guid", async () => {
    deck = [film("Movie A", 2020, { guid: undefined }), film("Movie B", 2021, { guid: undefined }), film("Movie A", 2019, { guid: undefined })];
    deckFake();
    assert.deepEqual(titles(await getOnDeck()), ["Movie A", "Movie B", "Movie A"], "same title in a different year is a different movie");
  });

  it("returns rows for the table: show poster for an episode, no year for an episode, the movie's year for a movie", async () => {
    deck = [episode("Ted Lasso", 4, 5, "Riches of Embarrassment"), film("Scream", 2022)];
    deckFake();
    assert.deepEqual(rows(await getOnDeck()), [
      {
        kind: "show",
        title: "Ted Lasso",
        year: null,
        posterUrl: "/api/plex/image?path=%2Flibrary%2Fmetadata%2F9%2Fthumb%2F9",
        libraries: ["TV Shows"],
        genres: [],
        rating: null,
        detail: 'S4E05 "Riches of Embarrassment" - 57% watched, last watched 2026-09-19',
        lastWatched: "2026-09-19",
      },
      {
        kind: "movie",
        title: "Scream",
        year: 2022,
        posterUrl: "/api/plex/image?path=%2Flibrary%2Fmetadata%2F2022%2Fthumb%2F3",
        libraries: ["Movies"],
        genres: [],
        rating: null,
        detail: "70% watched, last watched 2026-09-16",
        lastWatched: "2026-09-16",
      },
    ]);
    assert.doesNotMatch(JSON.stringify(rows(await getOnDeck())), /X-Plex-Token|http:\/\/plex/);
  });

  it("filters by media type", async () => {
    deck = [episode("Ted Lasso", 4, 5, "x"), film("Scream", 2022), episode("Lioness", 3, 2, "y")];
    deckFake();
    assert.deepEqual(titles(await getOnDeck({ mediaType: "show" })), ["Ted Lasso", "Lioness"]);
    assert.deepEqual(titles(await getOnDeck({ mediaType: "movie" })), ["Scream"]);
    assert.equal(rows(await getOnDeck({ mediaType: "any" })).length, 3);
    deck = [film("Scream", 2022)];
    assert.match(textOf(await getOnDeck({ mediaType: "show" })), /^Nothing is on deck in Plex for shows\.$/);
  });

  it("filters by title, so a question about one show gets one row (found in the browser)", async () => {
    deck = [episode("Ted Lasso", 4, 5, "x"), episode("Dark Matter (2024)", 2, 1, "A Quiet Life", { viewOffset: undefined }), film("Dark Water", 2005), film("Scream", 2022), film("Matter of Time", 2010)];
    deckFake();
    assert.deepEqual(titles(await getOnDeck({ title: "dark matter" })), ["Dark Matter (2024)"]);
    assert.deepEqual(titles(await getOnDeck({ title: "  DARK  " })), ["Dark Matter (2024)", "Dark Water"], "case-insensitive, trimmed, matches shows and movies");
    assert.deepEqual(titles(await getOnDeck({ title: "matter", mediaType: "show" })), ["Dark Matter (2024)"]);
    assert.equal(rows(await getOnDeck({ title: "   " })).length, 5, "a blank title is no filter");
    const none = await getOnDeck({ title: "Severance" });
    assert.match(textOf(none), /^Nothing on deck matches "Severance"\. Plex lists a show here only once it has been started/);
    assert.equal(none.isError, undefined);
  });

  it("says it is not the complete list of unfinished titles", async () => {
    deck = [film("Scream", 2022)];
    deckFake();
    assert.match(textOf(await getOnDeck()), /NOT every unfinished title: for a complete list of what is unwatched or unfinished use search_plex_library with its watched filter/);
  });

  it("filters by library name, and lists the libraries that have something when none match", async () => {
    deck = [episode("Jessie", 2, 22, "x", { librarySectionTitle: "Kid's TV Shows" }), film("Sing 2", 2021, { librarySectionTitle: "Kid's Movies" }), film("Scream", 2022, { librarySectionTitle: "Movies" })];
    deckFake();
    assert.deepEqual(titles(await getOnDeck({ library: "KID" })), ["Jessie", "Sing 2"]);
    const none = await getOnDeck({ library: "anime" });
    assert.match(textOf(none), /^Nothing on deck in a library matching "anime"\. Libraries with something on deck: Kid's TV Shows, Kid's Movies, Movies\.$/);
    assert.equal(none.isError, undefined);
  });

  it("limits the list (default 10, at most 50, at least 1) and says how many were left out", async () => {
    deck = Array.from({ length: 30 }, (_, i) => film(`Movie ${i}`, 2000 + i));
    deckFake();
    const first = await getOnDeck();
    assert.equal(rows(first).length, 10);
    assert.match(textOf(first), /: 30 items\n/);
    assert.match(textOf(first), /Listed the first 10; 20 more are not listed \(limit up to 50\)\./);
    assert.equal(rows(await getOnDeck({ limit: 500 })).length, 30);

    assert.equal(rows(await getOnDeck({ limit: 0 })).length, 1);
    assert.equal(rows(await getOnDeck({ limit: 3 })).length, 3);
    assert.doesNotMatch(textOf(await getOnDeck({ limit: 50 })), /more are not listed/);
    deck = Array.from({ length: 60 }, (_, i) => film(`Movie ${i}`, 2000 + i));
    assert.equal(rows(await getOnDeck({ limit: 500 })).length, 50, "never more than 50, whatever is asked for");
  });

  it("ignores things that are neither a movie nor an episode", async () => {
    deck = [{ type: "track", title: "A Song" }, film("Scream", 2022), { type: "clip", title: "Trailer" }];
    deckFake();
    assert.deepEqual(titles(await getOnDeck()), ["Scream"]);
  });

  it("says so when nothing is on deck", async () => {
    deckFake();
    const result = await getOnDeck();
    assert.equal(result.isError, undefined);
    assert.match(textOf(result), /^Nothing is on deck in Plex\.$/);
    assert.equal((result as any).structuredContent, undefined);
  });

  it("says so when Plex isn't configured, without calling it", async () => {
    setSetting("PLEX_URL", "");
    deckFake();
    const result = await getOnDeck();
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Plex isn't configured/);
    assert.equal(fake.calls.length, 0);
  });

  it("reports a Plex outage as an error", async () => {
    deckFake(() => ({ status: 500 }));
    const result = await getOnDeck();
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Failed to read On Deck from Plex/);
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
