import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { plexClient, tmdbClient } from "../src/clients.js";
import { resolveActorFilmography } from "../src/tools/discovery.js";
import { resetOwnedTmdbIndexCache } from "../src/tools/plex.js";
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

let tmdb: ReturnType<typeof fakeApi>;
let plex: ReturnType<typeof fakeApi> | undefined;
let plexOwns: number[]; // TMDb ids Plex holds in its "Movies" library
let plex4k: number[]; // ... and in its "4k Movies" library
let plexDown: boolean;

beforeEach(async () => {
  await resetDb();
  resetOwnedTmdbIndexCache();
  plexOwns = [1, 3];
  plex4k = [3];
  plexDown = false;
  tmdb = fakeApi(tmdbClient, (req) => {
    if (req.url.startsWith("/search/person")) {
      return { data: { results: req.url.includes("Nobody") ? [] : [{ id: 42, name: "Some Actor" }] } };
    }
    if (req.url === "/person/42/movie_credits") return { data: { cast: CREDITS } };
    return { status: 404 };
  });
  setSetting("PLEX_URL", "http://plex:32400");
  plex = fakeApi(plexClient, (req) => {
    if (plexDown) throw new Error("connect ECONNREFUSED");
    if (req.url === "/library/sections") {
      return { data: { MediaContainer: { Directory: [{ key: "1", type: "movie", title: "Movies" }, { key: "2", type: "movie", title: "4k Movies" }] } } };
    }
    const all = req.url.match(/^\/library\/sections\/(\d)\/all$/);
    if (all) {
      const items = (all[1] === "1" ? plexOwns : plex4k).map((id) => ({ title: `T${id}`, Guid: [{ id: `tmdb://${id}` }] }));
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

describe("resolveActorFilmography", () => {
  it("drops self appearances, uncredited roles, documentaries and archive footage; newest first", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 50 });
    assert.deepEqual(rows(result).map((m) => m.title), ["Newest", "Middle", "Oldest", "No Poster Or Date"]);
    assert.match(text(result), /Filtered filmography to 4 structural movie targets/);
  });

  it("marks which titles are in Plex, in which libraries, with a summary", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 50 });
    const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
    assert.deepEqual(byTitle.Newest.libraries, ["Movies"]);
    assert.deepEqual(byTitle.Middle.libraries, []);
    assert.deepEqual(byTitle.Oldest.libraries, ["Movies", "4k Movies"], "held in both libraries");
    assert.match(text(result), /In your Plex library: 2 of 4\./);
    assert.match(text(result), /Newest \(2023\) - As: Role in Newest - ✅ In Plex \(Movies\)/);
    assert.match(text(result), /Middle \(1999\) - As: Role in Middle - ❌ Not in Plex/);
  });

  it("filters by release year, keeping titles with no date out of a year range", async () => {
    const result = await resolveActorFilmography("Some Actor", { yearFrom: 1990, yearTo: 2000 });
    assert.deepEqual(rows(result).map((m) => m.title), ["Middle"]);
    assert.match(text(result), /Showing 1 titles \(released 1990-2000\)/);
  });

  it("show=missing / show=owned narrows to exactly those rows", async () => {
    const missing = await resolveActorFilmography("Some Actor", { show: "missing", limit: 50 });
    assert.ok(rows(missing).every((m) => m.libraries.length === 0));
    assert.deepEqual(rows(missing).map((m) => m.title).sort(), ["Middle", "No Poster Or Date"]);
    const owned = await resolveActorFilmography("Some Actor", { show: "owned" });
    assert.deepEqual(rows(owned).map((m) => m.title), ["Newest", "Oldest"]);
    assert.match(text(owned), /not in Plex|in Plex/);
  });

  it("combines year and ownership filters (the '1980s I'm missing' question)", async () => {
    plexOwns = [1];
    plex4k = [];
    const result = await resolveActorFilmography("Some Actor", { yearFrom: 1980, yearTo: 1989, show: "missing" });
    assert.deepEqual(rows(result).map((m) => m.title), ["Oldest"]);
  });

  it("limits the list and says how many were left out", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 2 });
    assert.equal(rows(result).length, 2);
    assert.match(text(result), /and 2 additional titles/);
  });

  it("builds web rows with a TMDb poster, role, rating and null for missing data", async () => {
    const result = await resolveActorFilmography("Some Actor", { limit: 50 });
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
    const result = await resolveActorFilmography("Nobody At All");
    assert.equal(result.isError, true);
    assert.match(text(result), /could not be resolved on TMDb/);
  });

  it("still returns the filmography, without ownership info, when Plex isn't configured", async () => {
    setSetting("PLEX_URL", "");
    const result = await resolveActorFilmography("Some Actor");
    assert.doesNotMatch(text(result), /In your Plex library/);
    assert.ok(rows(result).every((m) => m.libraries === null));
    assert.equal(plex!.calls.length, 0);
  });

  it("still returns the filmography, with a note, when Plex is down", async () => {
    plexDown = true;
    const result = await resolveActorFilmography("Some Actor");
    assert.match(text(result), /Couldn't check Plex ownership/);
    assert.ok(rows(result).length > 0);
    assert.ok(rows(result).every((m) => m.libraries === null));
  });

  describe("library filter", () => {
    it("judges ownership only against matching libraries", async () => {
      const result = await resolveActorFilmography("Some Actor", { library: "4k", limit: 50 });
      const byTitle = Object.fromEntries(rows(result).map((m) => [m.title, m]));
      assert.deepEqual(byTitle.Oldest.libraries, ["4k Movies"], "held in 4K");
      assert.deepEqual(byTitle.Newest.libraries, [], "in Plex, but only in the non-4K library, so not owned in 4K");
      assert.match(text(result), /In your Plex libraries matching "4k": 1 of 4\./);
    });

    it("with show=missing lists what isn't in 4K, including titles owned in HD", async () => {
      const result = await resolveActorFilmography("Some Actor", { library: "4k", show: "missing", limit: 50 });
      assert.deepEqual(rows(result).map((m) => m.title).sort(), ["Middle", "Newest", "No Poster Or Date"]);
    });

    it("with show=owned lists only what is in a matching library", async () => {
      const result = await resolveActorFilmography("Some Actor", { library: "4K", show: "owned" });
      assert.deepEqual(rows(result).map((m) => m.title), ["Oldest"]);
    });

    it("reports a library name that matches nothing, listing the real ones", async () => {
      const result = await resolveActorFilmography("Some Actor", { library: "anime" });
      assert.equal(result.isError, true);
      assert.match(text(result), /No Plex movie library matching "anime"\. Movie libraries with titles: .*Movies/);
    });
  });
});

