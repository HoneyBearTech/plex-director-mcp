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
];
const GENRES: Record<string, Array<{ key: string; title: string }>> = {
  "1": [{ key: "930", title: "Horror" }, { key: "106", title: "Action" }],
  "2": [{ key: "106", title: "Action" }],
  "3": [{ key: "999", title: "Drama" }],
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
  library = { "1": [], "2": [], "3": [movie("Should Never Appear", 1999)] };
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
    const result = await searchPlexLibrary({ genre: "Nonexistent" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No genre "Nonexistent" in Plex\. Available genres: Action, Horror\./);
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
  const rowsOf = (r: any) => r.structuredContent.movies as any[];
  const bullets = (r: { content: Array<{ text: string }> }) => textOf(r).split("\n").filter((l) => l.startsWith("- "));

  it("searches every movie library and no other kind", async () => {
    library["1"] = [movie("Heat", 1995)];
    library["2"] = [movie("Heat", 1995)];
    plexFake();
    const result = await searchPlexLibrary({ title: "heat" });
    assert.deepEqual(allCalls().map((c) => c.url).sort(), ["/library/sections/1/all", "/library/sections/2/all"]);
    assert.doesNotMatch(textOf(result), /Should Never Appear/);
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
    assert.match(textOf(result), /No movies in Plex match title "nothing"/);
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
    const result = await searchPlexLibrary({ title: "x", library: "4K" });
    assert.deepEqual(allCalls().map((c) => c.url), ["/library/sections/2/all"]);
    const rows = (result as any).structuredContent.movies as any[];
    assert.deepEqual(rows.map((r) => r.libraries), [["4k Movies"], ["4k Movies"]]);
    assert.match(textOf(result), /in "4k Movies"/);
  });

  it("works as the only filter (list everything in a library)", async () => {
    plexFake();
    const result = await searchPlexLibrary({ library: "movies" });
    assert.equal(result.isError, undefined);
    assert.equal(allCalls().length, 2, "'movies' matches both Movies and 4k Movies");
  });

  it("resolves a genre against every library even if the filtered library doesn't list it", async () => {
    plexFake();
    // Horror (930) exists only in section 1's genre list; the search is restricted to the 4K library.
    await searchPlexLibrary({ genre: "Horror", library: "4k" });
    assert.deepEqual(allCalls().map((c) => c.url), ["/library/sections/2/all"]);
    assert.equal(allCalls()[0]!.params.genre, "930");
  });

  it("lists the movie libraries when none match", async () => {
    plexFake();
    const result = await searchPlexLibrary({ title: "x", library: "anime" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /No movie library matching "anime" in Plex\. Movie libraries: Movies, 4k Movies\./);
    assert.equal(allCalls().length, 0);
  });
});

describe("searchPlexLibrary: paging and large results", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => movie(`Movie ${String(i).padStart(3, "0")}`, 2000, { titleSort: `Movie ${String(i).padStart(3, "0")}`, Guid: [{ id: `tmdb://${i}` }] }));
  const titles = (r: any) => (r.structuredContent.movies as any[]).map((m) => m.title);

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
