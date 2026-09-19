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
    assert.match(textOf(result), /at least one of/);
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
    assert.match(textOf(result), /3 matches \(showing 2\)/);
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
