import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plexClient, tmdbClient } from "../src/clients.js";
import { resolveActorFilmography } from "../src/tools/discovery.js";
import { getOwnedTmdbIndex, resetOwnedTmdbIndexCache } from "../src/tools/plex.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb } from "./helpers.js";

const credit = (id: number, title: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  release_date: date,
  character: `Role in ${title}`,
  genre_ids: [28],
  poster_path: `/p${id}.jpg`,
  vote_average: 6.5,
  ...extra,
});

const CREDITS = [
  credit(1, "Newest", "2023-05-01"),
  credit(2, "Middle", "1999-01-01"),
  credit(3, "Oldest", "1980-06-01"),
  credit(4, "As Himself", "2010-01-01", { character: "Self" }),
  credit(5, "Cameo", "2011-01-01", { character: "Bartender (uncredited)" }),
  credit(6, "A Documentary", "2012-01-01", { genre_ids: [99] }),
  credit(7, "Archive Reel", "2013-01-01", { character: "Historical Footage" }),
  credit(8, "No Poster Or Date", "", { poster_path: null, release_date: null, vote_average: 0 }),
];

const tvCredit = (id: number, name: string, date: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  first_air_date: date,
  character: `Part in ${name}`,
  genre_ids: [18],
  poster_path: `/tv${id}.jpg`,
  vote_average: 8.25,
  episode_count: 3,
  ...extra,
});

// TMDb TV ids are a separate id space from movie ids: show 1 is NOT movie 1.
const TV_CREDITS = [
  tvCredit(101, "Long Show", "2008-01-20"),
  tvCredit(102, "Guest Spot", "2015-03-01"),
  tvCredit(1, "Same Number As A Movie", "2001-01-01"),
  tvCredit(103, "Late Night Talk", "2010-01-01", { genre_ids: [10767], character: "Guest" }),
  tvCredit(104, "News Hour", "2010-02-01", { genre_ids: [10763], character: "Guest" }),
  tvCredit(105, "Hosting Self", "2010-03-01", { character: "Self - Host" }),
  tvCredit(106, "Bit Part", "2010-04-01", { character: "Bartender (uncredited)" }),
  tvCredit(107, "A Docuseries", "2010-05-01", { genre_ids: [99] }),
  tvCredit(108, "No Date Show", null, { poster_path: null, vote_average: 0 }),
];

let tmdb: ReturnType<typeof fakeApi>;
let plex: ReturnType<typeof fakeApi> | undefined;
let plexOwns: number[]; // TMDb ids Plex holds in its "Movies" library
let plex4k: number[]; // ... and in its "4k Movies" library
let plexShows: number[]; // TMDb TV ids Plex holds in its "TV Shows" library
let plexShows4k: number[]; // ... and in "4k TV Shows"
let plexDown: boolean;

beforeEach(async () => {
  await resetDb();
  resetOwnedTmdbIndexCache();
  plexOwns = [1, 3];
  plex4k = [3];
  plexShows = [101];
  plexShows4k = [101];
  plexDown = false;
  tmdb = fakeApi(tmdbClient, (req) => {
    if (req.url.startsWith("/search/person")) {
      return { data: { results: req.url.includes("Nobody") ? [] : [{ id: 42, name: "Some Actor" }] } };
    }
    if (req.url === "/person/42/movie_credits") return { data: { cast: CREDITS } };
    if (req.url === "/person/42/tv_credits") return { data: { cast: TV_CREDITS } };
    return { status: 404 };
  });
  setSetting("PLEX_URL", "http://plex:32400");
  plex = fakeApi(plexClient, (req) => {
    if (plexDown) throw new Error("connect ECONNREFUSED");
    if (req.url === "/library/sections") {
      return {
        data: {
          MediaContainer: {
            Directory: [
              { key: "1", type: "movie", title: "Movies" },
              { key: "2", type: "movie", title: "4k Movies" },
              { key: "3", type: "show", title: "TV Shows" },
              { key: "4", type: "show", title: "4k TV Shows" },
            ],
          },
        },
      };
    }
    const all = req.url.match(/^\/library\/sections\/(\d)\/all$/);
    if (all) {
      const ids = { "1": plexOwns, "2": plex4k, "3": plexShows, "4": plexShows4k }[all[1] as "1" | "2" | "3" | "4"];
      const items = ids.map((id) => ({ title: `T${id}`, Guid: [{ id: `tmdb://${id}` }] }));
      return { data: { MediaContainer: { totalSize: items.length, Metadata: items } } };
    }
    return { status: 404 };
  });
});
afterEach(() => {
  tmdb.restore();
  plex?.restore();
});

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => r.structuredContent.media as Array<Record<string, any>>;

// The pre-TV behaviour: these tests are about movies, so they ask for movies only.
const film = (actor: string, options: Parameters<typeof resolveActorFilmography>[1] = {}) => resolveActorFilmography(actor, { mediaType: "movie", ...options });

describe("resolveActorFilmography", () => {
  it("drops self appearances, uncredited roles, documentaries and archive footage; newest first", async () => {
    const result = await film("Some Actor", { limit: 50 });
    assert.deepEqual(rows(result).map((m) => m.title), ["Newest", "Middle", "Oldest", "No Poster Or Date"]);
    assert.match(text(result), /Filtered filmography to 4 structural movie targets/);
  });

  it("marks which titles are in Plex, in which libraries, with a summary", async () => {
    const result = await film("Some Actor", { limit: 50 });
    const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
    assert.deepEqual(byTitle.Newest.libraries, ["Movies"]);
    assert.deepEqual(byTitle.Middle.libraries, []);
    assert.deepEqual(byTitle.Oldest.libraries, ["Movies", "4k Movies"], "held in both libraries");
    assert.match(text(result), /In your Plex library: 2 of 4\./);
    assert.match(text(result), /Newest \(2023\) - As: Role in Newest - ✅ In Plex \(Movies\)/);
    assert.match(text(result), /Middle \(1999\) - As: Role in Middle - ❌ Not in Plex/);
  });

  it("filters by release year, keeping titles with no date out of a year range", async () => {
    const result = await film("Some Actor", { yearFrom: 1990, yearTo: 2000 });
    assert.deepEqual(rows(result).map((m) => m.title), ["Middle"]);
    assert.match(text(result), /Showing 1 titles \(released 1990-2000\)/);
  });

  it("show=missing / show=owned narrows to exactly those rows", async () => {
    const missing = await film("Some Actor", { show: "missing", limit: 50 });
    assert.ok(rows(missing).every((m) => m.libraries.length === 0));
    assert.deepEqual(rows(missing).map((m) => m.title).sort(), ["Middle", "No Poster Or Date"]);
    const owned = await film("Some Actor", { show: "owned" });
    assert.deepEqual(rows(owned).map((m) => m.title), ["Newest", "Oldest"]);
    assert.match(text(owned), /not in Plex|in Plex/);
  });

  it("combines year and ownership filters (the '1980s I'm missing' question)", async () => {
    plexOwns = [1];
    plex4k = [];
    const result = await film("Some Actor", { yearFrom: 1980, yearTo: 1989, show: "missing" });
    assert.deepEqual(rows(result).map((m) => m.title), ["Oldest"]);
  });

  it("limits the list and says how many were left out", async () => {
    const result = await film("Some Actor", { limit: 2 });
    assert.equal(rows(result).length, 2);
    assert.match(text(result), /and 2 additional titles/);
  });

  it("builds web rows with a TMDb poster, role, rating and null for missing data", async () => {
    const result = await film("Some Actor", { limit: 50 });
    const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
    assert.equal(byTitle.Newest.posterUrl, "https://image.tmdb.org/t/p/w154/p1.jpg");
    assert.equal(byTitle.Newest.year, 2023);
    assert.equal(byTitle.Newest.detail, "As Role in Newest");
    assert.equal(byTitle.Newest.rating, 6.5);
    assert.equal(byTitle["No Poster Or Date"].posterUrl, null);
    assert.equal(byTitle["No Poster Or Date"].year, null);
    assert.equal(byTitle["No Poster Or Date"].rating, null);
  });

  it("reports an actor TMDb can't resolve", async () => {
    const result = await film("Nobody At All");
    assert.equal(result.isError, true);
    assert.match(text(result), /could not be resolved on TMDb/);
  });

  it("still returns the filmography, without ownership info, when Plex isn't configured", async () => {
    setSetting("PLEX_URL", "");
    const result = await film("Some Actor");
    assert.doesNotMatch(text(result), /In your Plex library/);
    assert.ok(rows(result).every((m) => m.libraries === null));
    assert.equal(plex!.calls.length, 0);
  });

  it("still returns the filmography, with a note, when Plex is down", async () => {
    plexDown = true;
    const result = await film("Some Actor");
    assert.match(text(result), /Couldn't check Plex ownership/);
    assert.ok(rows(result).length > 0);
    assert.ok(rows(result).every((m) => m.libraries === null));
  });

  describe("library filter", () => {
    it("judges ownership only against matching libraries", async () => {
      const result = await film("Some Actor", { library: "4k", limit: 50 });
      const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
      assert.deepEqual(byTitle.Oldest.libraries, ["4k Movies"], "held in 4K");
      assert.deepEqual(byTitle.Newest.libraries, [], "in Plex, but only in the non-4K library, so not owned in 4K");
      assert.match(text(result), /In your Plex libraries matching "4k": 1 of 4\./);
    });

    it("with show=missing lists what isn't in 4K, including titles owned in HD", async () => {
      const result = await film("Some Actor", { library: "4k", show: "missing", limit: 50 });
      assert.deepEqual(rows(result).map((m) => m.title).sort(), ["Middle", "Newest", "No Poster Or Date"]);
    });

    it("with show=owned lists only what is in a matching library", async () => {
      const result = await film("Some Actor", { library: "4K", show: "owned" });
      assert.deepEqual(rows(result).map((m) => m.title), ["Oldest"]);
    });

    it("reports a library name that matches nothing, listing the real ones", async () => {
      const result = await film("Some Actor", { library: "anime" });
      assert.equal(result.isError, true);
      assert.match(text(result), /No Plex movie library matching "anime"\. Movie libraries with titles: .*Movies/);
    });
  });
});


describe("resolveActorFilmography: TV shows", () => {
  const titles = (r: any) => rows(r).map((m) => m.title);
  const tmdbUrls = () => tmdb.calls.map((c) => c.url).filter((u) => u.startsWith("/person/"));
  const plexUrls = () => plex!.calls.map((c) => c.url).filter((u) => /\/all$/.test(u)).sort();

  it("merges movies and shows newest first by default, tagging each with its kind", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 50 });
    assert.deepEqual(
      rows(result).map((m) => [m.kind, m.title, m.year]),
      [
        ["movie", "Newest", 2023],
        ["show", "Guest Spot", 2015],
        ["show", "Long Show", 2008],
        ["show", "Same Number As A Movie", 2001],
        ["movie", "Middle", 1999],
        ["movie", "Oldest", 1980],
        ["movie", "No Poster Or Date", null],
        ["show", "No Date Show", null],
      ]
    );
    assert.match(text(result), /Filtered filmography to 8 structural movie and TV targets/);
  });

  it("drops talk shows, news, self appearances, uncredited parts and documentaries from TV credits", async () => {
    const result = await resolveActorFilmography("Some Actor", { mediaType: "show", limit: 50 });
    assert.deepEqual(titles(result), ["Guest Spot", "Long Show", "Same Number As A Movie", "No Date Show"]);
    assert.match(text(result), /Filtered filmography to 4 structural TV show targets \(removed docs, talk shows, news, uncredited and self appearances\)/);
  });

  it("does not apply the talk/news genre filter to movies", async () => {
    // Movies keep the original rule: only documentaries are dropped by genre.
    const original = CREDITS.length;
    CREDITS.push(credit(9, "Odd Genre Movie", "2020-01-01", { genre_ids: [10767] }));
    try {
      assert.ok(titles(await film("Some Actor", { limit: 50 })).includes("Odd Genre Movie"));
      assert.ok(!titles(await resolveActorFilmography("Some Actor", { mediaType: "show", limit: 50 })).includes("Odd Genre Movie"));
    } finally {
      CREDITS.length = original;
    }
  });

  it("mediaType movie asks TMDb and Plex for movies only; mediaType show for shows only", async () => {
    await resolveActorFilmography("Some Actor", { mediaType: "movie" });
    assert.deepEqual(tmdbUrls(), ["/person/42/movie_credits"]);
    assert.deepEqual(plexUrls(), ["/library/sections/1/all", "/library/sections/2/all"]);
    tmdb.calls.length = 0;
    plex!.calls.length = 0;
    resetOwnedTmdbIndexCache();
    await resolveActorFilmography("Some Actor", { mediaType: "show" });
    assert.deepEqual(tmdbUrls(), ["/person/42/tv_credits"]);
    assert.deepEqual(plexUrls(), ["/library/sections/3/all", "/library/sections/4/all"]);
  });

  it("marks shows owned from the SHOW index, with HD and 4K libraries stacked", async () => {
    const result = await resolveActorFilmography("Some Actor", { mediaType: "show", limit: 50 });
    const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
    assert.deepEqual(byTitle["Long Show"].libraries, ["TV Shows", "4k TV Shows"]);
    assert.deepEqual(byTitle["Guest Spot"].libraries, []);
    assert.match(text(result), /In your Plex library: 1 of 4\./);
    assert.match(text(result), /Long Show \(2008\) \[TV show\] - As: Part in Long Show - ✅ In Plex \(TV Shows, 4k TV Shows\)/);
    assert.match(text(result), /Guest Spot \(2015\) \[TV show\] - As: Part in Guest Spot - ❌ Not in Plex/);
  });

  it("keeps movie and TV ids apart: movie 1 owned in Plex does not make TV show 1 owned", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 50 });
    const byKey = Object.fromEntries(rows(result).map((m) => [`${m.kind}:${m.title}`, m]));
    assert.deepEqual(byKey["movie:Newest"]!.libraries, ["Movies"], "movie id 1 is in the Movies library");
    assert.deepEqual(byKey["show:Same Number As A Movie"]!.libraries, [], "TV id 1 is a different thing");
  });

  it("summarises both kinds when asked for both", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 50 });
    assert.match(text(result), /In your Plex library: 3 of 8 \(2 of 4 movies, 1 of 4 TV shows\)\./);
  });

  it("show=owned / show=missing and year filters cover both kinds (a show's year is its first air date)", async () => {
    const owned = await resolveActorFilmography("Some Actor", { show: "owned", limit: 50 });
    assert.deepEqual(titles(owned), ["Newest", "Long Show", "Oldest"]);
    const missing = await resolveActorFilmography("Some Actor", { show: "missing", limit: 50 });
    assert.deepEqual(titles(missing), ["Guest Spot", "Same Number As A Movie", "Middle", "No Poster Or Date", "No Date Show"]);
    const decade = await resolveActorFilmography("Some Actor", { yearFrom: 2000, yearTo: 2009, limit: 50 });
    assert.deepEqual(titles(decade), ["Long Show", "Same Number As A Movie"], "titles with no date stay out of a range");
  });

  it("the library filter judges shows too: '4k' means held in a 4K movie OR 4K show library", async () => {
    plexShows = [101, 102];
    plexShows4k = [101];
    const result = await resolveActorFilmography("Some Actor", { library: "4k", show: "owned", limit: 50 });
    assert.deepEqual(titles(result), ["Long Show", "Oldest"]);
    assert.deepEqual(Object.fromEntries(rows(result).map((m) => [m.title, m.libraries])), { "Long Show": ["4k TV Shows"], Oldest: ["4k Movies"] });
  });

  it("names the libraries that exist when the filter matches none", async () => {
    const both = await resolveActorFilmography("Some Actor", { library: "anime" });
    assert.equal(both.isError, true);
    assert.match(text(both), /No Plex library matching "anime"\. Libraries with titles: .*Movies.*TV Shows/);
    const shows = await resolveActorFilmography("Some Actor", { library: "anime", mediaType: "show" });
    assert.match(text(shows), /No Plex show library matching "anime"\. Show libraries with titles: TV Shows, 4k TV Shows\./);
  });

  it("builds web rows for shows: TMDb poster, first-air year, role, rating, no Plex season data", async () => {
    const result = await resolveActorFilmography("Some Actor", { mediaType: "show", limit: 50 });
    const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
    assert.deepEqual(byTitle["Long Show"], {
      kind: "show",
      title: "Long Show",
      year: 2008,
      posterUrl: "https://image.tmdb.org/t/p/w154/tv101.jpg",
      libraries: ["TV Shows", "4k TV Shows"],
      genres: [],
      rating: 8.25,
      detail: "As Part in Long Show",
    });
    assert.equal(byTitle["No Date Show"].year, null);
    assert.equal(byTitle["No Date Show"].posterUrl, null);
    assert.equal(byTitle["No Date Show"].rating, null);
  });

  it("limits across both kinds and says how many were left out", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 3 });
    assert.equal(rows(result).length, 3);
    assert.match(text(result), /and 5 additional titles/);
  });

  it("still returns both kinds, unmarked, with a note, when Plex is down", async () => {
    plexDown = true;
    const result = await resolveActorFilmography("Some Actor", { limit: 50 });
    assert.match(text(result), /Couldn't check Plex ownership/);
    assert.equal(rows(result).length, 8);
    assert.ok(rows(result).every((m) => m.libraries === null));
  });

  it("fails as a whole if TMDb can't supply the TV credits, rather than silently dropping shows", async () => {
    tmdb.restore();
    tmdb = fakeApi(tmdbClient, (req) => {
      if (req.url.startsWith("/search/person")) return { data: { results: [{ id: 42, name: "Some Actor" }] } };
      if (req.url === "/person/42/movie_credits") return { data: { cast: CREDITS } };
      return { status: 500 };
    });
    const result = await resolveActorFilmography("Some Actor");
    assert.equal(result.isError, true);
    assert.match(text(result), /TMDb Resolution failed/);
    // ...while a movies-only question does not depend on the TV endpoint at all.
    assert.notEqual((await film("Some Actor")).isError, true);
  });

  it("does not touch Plex when it isn't configured, and still lists shows", async () => {
    setSetting("PLEX_URL", "");
    const result = await resolveActorFilmography("Some Actor", { mediaType: "show" });
    assert.equal(plex!.calls.length, 0);
    assert.ok(rows(result).every((m) => m.libraries === null));
    assert.equal(rows(result).length, 4);
  });

  // Found live: TMDb lists Family Guy six times for one actor (one entry per voiced role).
  it("shows a title once, with its roles joined, when TMDb lists it once per role", async () => {
    CREDITS.push(credit(2, "Middle", "1999-01-01", { character: "Second Role" }), credit(2, "Middle", "1999-01-01", { character: "Role in Middle" }));
    TV_CREDITS.push(tvCredit(101, "Long Show", "2008-01-20", { character: "Voice" }), tvCredit(101, "Long Show", "2008-01-20", { character: "" }));
    try {
      const result = await resolveActorFilmography("Some Actor", { limit: 50 });
      assert.equal(titles(result).filter((t) => t === "Middle").length, 1);
      assert.equal(titles(result).filter((t) => t === "Long Show").length, 1);
      assert.equal(rows(result).length, 8, "same rows as without the repeats");
      const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
      assert.equal(byTitle["Middle"].detail, "As Role in Middle / Second Role", "the same role twice is kept once");
      assert.equal(byTitle["Long Show"].detail, "As Part in Long Show / Voice", "an empty role adds nothing");
      assert.match(text(result), /In your Plex library: 3 of 8 \(2 of 4 movies, 1 of 4 TV shows\)\./, "counts titles, not credits");
    } finally {
      CREDITS.length -= 2;
      TV_CREDITS.length -= 2;
    }
  });

  it("lists each role once even when TMDb packs several roles into one credit", async () => {
    TV_CREDITS.push(
      tvCredit(101, "Long Show", "2008-01-20", { character: "Bert (voice) / Judge (voice)" }),
      tvCredit(101, "Long Show", "2008-01-20", { character: "Bert (voice)" }),
      tvCredit(101, "Long Show", "2008-01-20", { character: "Judge (voice) / Clerk" })
    );
    try {
      const longShow = rows(await resolveActorFilmography("Some Actor", { mediaType: "show", limit: 50 })).find((m) => m.title === "Long Show")!;
      assert.equal(longShow.detail, "As Part in Long Show / Bert (voice) / Judge (voice) / Clerk");
    } finally {
      TV_CREDITS.length -= 3;
    }
  });

  it("keeps a real role when the same title is also listed as a 'Self' appearance", async () => {
    TV_CREDITS.push(tvCredit(102, "Guest Spot", "2015-03-01", { character: "Self" }));
    try {
      const guest = rows(await resolveActorFilmography("Some Actor", { mediaType: "show", limit: 50 })).filter((m) => m.title === "Guest Spot");
      assert.equal(guest.length, 1);
      assert.equal(guest[0]!.detail, "As Part in Guest Spot");
    } finally {
      TV_CREDITS.length -= 1;
    }
  });

  it("caches the movie and show indexes separately", async () => {
    const movies = await getOwnedTmdbIndex("movie");
    const shows = await getOwnedTmdbIndex("show");
    assert.deepEqual([...movies.keys()].sort(), ["1", "3"]);
    assert.deepEqual([...shows.keys()], ["101"]);
    assert.deepEqual(shows.get("101"), ["TV Shows", "4k TV Shows"]);
    const before = plex!.calls.length;
    assert.equal(await getOwnedTmdbIndex("show"), shows, "second call is served from the cache");
    assert.equal(await getOwnedTmdbIndex("movie"), movies);
    assert.equal(plex!.calls.length, before);
    resetOwnedTmdbIndexCache();
    assert.notEqual(await getOwnedTmdbIndex("show"), shows, "the reset hook clears both kinds");
  });
});
