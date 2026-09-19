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
  it("searches every movie library and no other kind", async () => {
    library["1"] = [movie("Heat", 1995)];
    library["2"] = [movie("Heat", 1995)];
    plexFake();
    const result = await searchPlexLibrary({ title: "heat" });
    assert.deepEqual(allCalls().map((c) => c.url).sort(), ["/library/sections/1/all", "/library/sections/2/all"]);
    assert.doesNotMatch(textOf(result), /Should Never Appear/);
  });

  it("passes title, year and includeGuids through, and shows the TMDb id", async () => {
    library["1"] = [movie("Heat", 1995)];
    plexFake();
    const result = await searchPlexLibrary({ title: "heat", year: 1995 });
    const call = allCalls()[0]!;
    assert.equal(call.params.title, "heat");
    assert.equal(call.params.year, 1995);
    assert.equal(call.params.includeGuids, 1);
    assert.match(textOf(result), /\| Heat \| 1995 \| Movies \| Horror, Thriller \| 7\.4 \| 1995 \|/);
  });

  it("merges libraries, sorts by Plex's sort title, and honours the limit", async () => {
    library["1"] = [movie("Alien", 1979, { titleSort: "Alien" }), movie("The Thing", 1982, { titleSort: "Thing" })];
    library["2"] = [movie("Blade Runner", 1982, { titleSort: "Blade Runner" })];
    plexFake();
    const result = await searchPlexLibrary({ year: 1982, limit: 2 });
    const titles = ((result as any).structuredContent.movies as any[]).map((m) => m.title);
    assert.deepEqual(titles, ["Alien", "Blade Runner"], "The Thing sorts under T, not 'The', and is cut by the limit");
    assert.match(textOf(result), /3 matches \(showing 1-2\)\./);
    assert.match(textOf(result), /1 more not shown: call again with offset 2/);
    assert.equal(allCalls()[0]!.params["X-Plex-Container-Size"], 2);
  });

  it("attaches structured rows for the web table", async () => {
    library["2"] = [movie("Blade Runner 2049", 2017, { thumb: "/library/metadata/91684/thumb/123" })];
    plexFake();
    const result = await searchPlexLibrary({ title: "blade" });
    assert.deepEqual((result as any).structuredContent.movies, [
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
    const rows = ((await searchPlexLibrary({ title: "heat" })) as any).structuredContent.movies as any[];
    assert.match(rows[0].posterUrl, /^\/api\/plex\/image\?path=/);
    assert.doesNotMatch(JSON.stringify(rows), /X-Plex-Token|http:\/\/plex/);
  });

  it("escapes pipes and backslashes in titles so the table can't break", async () => {
    library["1"] = [movie("A|B", 2001), movie("Ends with \\", 2002)];
    plexFake();
    const text = textOf(await searchPlexLibrary({ title: "x" }));
    assert.match(text, /\| A\\\|B \|/);
    assert.match(text, /\| Ends with \\\\ \|/);
  });

  it("handles items with no rating, year or poster", async () => {
    library["1"] = [{ title: "Mystery", titleSort: "Mystery" }];
    plexFake();
    const result = await searchPlexLibrary({ title: "mystery" });
    assert.match(textOf(result), /\| Mystery \| N\/A \| Movies \|  \| N\/A \| N\/A \|/);
    assert.deepEqual(((result as any).structuredContent.movies as any[])[0].posterUrl, null);
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
  const many = (n: number) => Array.from({ length: n }, (_, i) => movie(`Movie ${String(i).padStart(3, "0")}`, 2000, { titleSort: `Movie ${String(i).padStart(3, "0")}` }));
  const titles = (r: any) => (r.structuredContent.movies as any[]).map((m) => m.title);

  it("allows up to 500 rows in one call (the old cap was 100) and clamps beyond that", async () => {
    library["1"] = many(600);
    plexFake();
    const result = await searchPlexLibrary({ title: "movie", limit: 500 });
    assert.equal(titles(result).length, 500);
    assert.match(textOf(result), /600 matches \(showing 1-500\)\. .*100 more not shown: call again with offset 500/);
    const clamped = await searchPlexLibrary({ title: "movie", limit: 9999 });
    assert.equal(titles(clamped).length, 500);
  });

  it("pages through a merged result with offset, without gaps or repeats", async () => {
    library["1"] = many(150).filter((_, i) => i % 2 === 0); // even-numbered titles
    library["2"] = many(150).filter((_, i) => i % 2 === 1); // odd-numbered titles
    plexFake();
    const first = await searchPlexLibrary({ title: "m", limit: 60 });
    const second = await searchPlexLibrary({ title: "m", limit: 60, offset: 60 });
    const third = await searchPlexLibrary({ title: "m", limit: 60, offset: 120 });
    const all = [...titles(first), ...titles(second), ...titles(third)];
    assert.equal(all.length, 150);
    assert.deepEqual(all, many(150).map((m) => m.title), "every title exactly once, in order");
    assert.match(textOf(first), /offset 60/);
    assert.match(textOf(second), /offset 120/);
    assert.doesNotMatch(textOf(third), /call again with offset/);
    assert.match(textOf(second), /showing 61-120/);
  });

  it("flags continuation pages so the UI appends them, and fresh searches so it replaces", async () => {
    library["1"] = many(30);
    plexFake();
    assert.equal(((await searchPlexLibrary({ title: "m", limit: 10 })) as any).structuredContent.append, false);
    assert.equal(((await searchPlexLibrary({ title: "m", limit: 10, offset: 10 })) as any).structuredContent.append, true);
  });

  it("lists at most 100 rows in the text the model reads, while the table gets every row", async () => {
    library["1"] = many(250);
    plexFake();
    const result = await searchPlexLibrary({ title: "m", limit: 250 });
    assert.equal(titles(result).length, 250);
    const tableRows = textOf(result).split("\n").filter((l) => l.startsWith("| Movie "));
    assert.equal(tableRows.length, 100);
    assert.match(textOf(result), /table already shows all 250 rows; only the first 100 are listed below.*do not request them again/);
  });

  it("says so when the offset is past the end", async () => {
    library["1"] = many(5);
    plexFake();
    const result = await searchPlexLibrary({ title: "m", offset: 50 });
    assert.match(textOf(result), /Offset 50 is past the end: there are only 5 matches/);
    assert.equal((result as any).structuredContent, undefined);
  });

  it("treats a negative offset as 0", async () => {
    library["1"] = many(3);
    plexFake();
    assert.equal(titles(await searchPlexLibrary({ title: "m", offset: -5 })).length, 3);
  });
});

describe("searchPlexLibrary: distinct movie count", () => {
  it("states how many distinct movies there are when a movie is in several libraries", async () => {
    library["1"] = [movie("Heat", 1995), movie("Ronin", 1998)];
    library["2"] = [movie("Heat", 1995)];
    plexFake();
    const text = textOf(await searchPlexLibrary({ title: "x" }));
    assert.match(text, /3 matches\./);
    assert.match(text, /That is 2 distinct movies: 1 of the 3 rows repeat a movie that is also held in another library\./);
  });
  it("says nothing about duplicates when there are none", async () => {
    library["1"] = [movie("Heat", 1995)];
    plexFake();
    assert.doesNotMatch(textOf(await searchPlexLibrary({ title: "x" })), /distinct/);
  });
  it("doesn't claim a distinct count for a partial page, where it can't be known", async () => {
    library["1"] = [movie("A", 2001), movie("B", 2002)];
    library["2"] = [movie("A", 2001), movie("B", 2002)];
    plexFake();
    assert.doesNotMatch(textOf(await searchPlexLibrary({ title: "x", limit: 2 })), /distinct/);
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
