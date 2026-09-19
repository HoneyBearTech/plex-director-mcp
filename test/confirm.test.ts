import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { radarrClient } from "../src/clients.js";
import { db } from "../src/db.js";
import { setSetting } from "../src/settings.js";
import { confirmSelectedChoices } from "../src/tools/discovery.js";
import { fakeApi, resetDb, type FakeReply, type RecordedRequest } from "./helpers.js";

const PROFILES = [
  { id: 5, name: "Remux + WEB 1080p" },
  { id: 7, name: "HD Bluray + WEB" },
  { id: 9, name: "Kids SQP-1 (1080p)" },
];
const ROOTS = [{ path: "/media/movies" }, { path: "/media/movieskids/" }];

let fake: ReturnType<typeof fakeApi>;
let inLibrary: Record<number, unknown[]>;
let addError: FakeReply | null;
let profiles: typeof PROFILES;
let roots: typeof ROOTS;

function radarr(extra?: (req: RecordedRequest) => FakeReply | undefined) {
  fake = fakeApi(radarrClient, (req) => {
    const custom = extra?.(req);
    if (custom) return custom;
    if (req.url === "/api/v3/qualityprofile") return { data: profiles };
    if (req.url === "/api/v3/rootfolder") return { data: roots };
    if (req.method === "get" && req.url === "/api/v3/movie") return { data: inLibrary[Number(req.params.tmdbId)] ?? [] };
    if (req.url === "/api/v3/movie/lookup/tmdb") return { data: { title: `Movie ${req.params.tmdbId}`, tmdbId: Number(req.params.tmdbId), year: 1999, images: [] } };
    if (req.method === "post" && req.url === "/api/v3/movie") return addError ?? { status: 201, data: {} };
    return { status: 404 };
  });
}
const posts = () => fake.calls.filter((c) => c.method === "post");
const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;

function pick(index: number, tmdbId: number, title: string) {
  db.prepare("INSERT INTO interaction_context (selection_index, tmdb_id, title, year) VALUES (?, ?, ?, ?)").run(index, tmdbId, title, "1999");
}

beforeEach(async () => {
  await resetDb();
  inLibrary = {};
  addError = null;
  profiles = [...PROFILES];
  roots = [...ROOTS];
});
afterEach(() => fake?.restore());

describe("confirmSelectedChoices: which quality profile", () => {
  beforeEach(() => pick(1, 603, "The Matrix"));

  it("uses Radarr's first profile when nothing is configured, and says so", async () => {
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1] });
    assert.equal((posts()[0]!.body as any).qualityProfileId, 5);
    assert.match(text(result), /profile: Remux \+ WEB 1080p - Radarr's first profile; set a default on the Settings page/);
  });

  it("uses the default saved on the Settings page (case-insensitively)", async () => {
    setSetting("RADARR_DEFAULT_QUALITY_PROFILE", "  hd bluray + web  ");
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1] });
    assert.equal((posts()[0]!.body as any).qualityProfileId, 7);
    assert.match(text(result), /\(profile: HD Bluray \+ WEB, folder/);
    assert.doesNotMatch(text(result), /first profile/);
  });

  it("a profile named by the caller beats the saved default", async () => {
    setSetting("RADARR_DEFAULT_QUALITY_PROFILE", "HD Bluray + WEB");
    radarr();
    await confirmSelectedChoices({ chosenIndexes: [1], qualityProfile: "kids sqp-1 (1080p)" });
    assert.equal((posts()[0]!.body as any).qualityProfileId, 9);
  });

  it("a blank caller value falls back to the default instead of failing", async () => {
    setSetting("RADARR_DEFAULT_QUALITY_PROFILE", "HD Bluray + WEB");
    radarr();
    await confirmSelectedChoices({ chosenIndexes: [1], qualityProfile: "   " });
    assert.equal((posts()[0]!.body as any).qualityProfileId, 7);
  });

  it("an unknown profile from the caller is an error listing the real ones, and adds nothing", async () => {
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1], qualityProfile: "Nope" });
    assert.equal(result.isError, true);
    assert.match(text(result), /No Radarr quality profile named "Nope"\. Available: Remux \+ WEB 1080p, HD Bluray \+ WEB, Kids SQP-1 \(1080p\)\./);
    assert.equal(posts().length, 0);
  });

  it("a saved default that no longer exists in Radarr says where it came from", async () => {
    setSetting("RADARR_DEFAULT_QUALITY_PROFILE", "Deleted Profile");
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1] });
    assert.equal(result.isError, true);
    assert.match(text(result), /"Deleted Profile" \(that is the default set on the Settings page\)/);
    assert.equal(posts().length, 0);
  });

  it("reports a Radarr with no quality profiles at all", async () => {
    profiles = [];
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1] });
    assert.equal(result.isError, true);
    assert.match(text(result), /no quality profiles configured/);
  });
});

describe("confirmSelectedChoices: root folder", () => {
  beforeEach(() => pick(1, 603, "The Matrix"));

  it("defaults to Radarr's first root folder", async () => {
    radarr();
    await confirmSelectedChoices({ chosenIndexes: [1] });
    assert.equal((posts()[0]!.body as any).rootFolderPath, "/media/movies");
  });

  it("honours a named folder, ignoring a trailing slash", async () => {
    radarr();
    await confirmSelectedChoices({ chosenIndexes: [1], rootFolder: "/media/movieskids" });
    assert.equal((posts()[0]!.body as any).rootFolderPath, "/media/movieskids/");
  });

  it("rejects an unknown folder, listing the real ones", async () => {
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1], rootFolder: "/nope" });
    assert.equal(result.isError, true);
    assert.match(text(result), /No Radarr root folder "\/nope"\. Available: \/media\/movies, \/media\/movieskids\//);
    assert.equal(posts().length, 0);
  });
});

describe("confirmSelectedChoices: adding movies", () => {
  it("adds the movie as monitored with a download search, building on Radarr's own lookup", async () => {
    pick(1, 603, "The Matrix");
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1] });
    assert.deepEqual(posts()[0]!.body, {
      title: "Movie 603",
      tmdbId: 603,
      year: 1999,
      images: [],
      qualityProfileId: 5,
      rootFolderPath: "/media/movies",
      monitored: true,
      minimumAvailability: "released",
      addOptions: { searchForMovie: true },
    });
    assert.match(text(result), /✅ \*\*Choice 1\*\*: The Matrix \(1999\) \[TMDb: 603\] - added and download search started/);
  });

  it("reports a movie already in Radarr instead of adding it again", async () => {
    pick(1, 603, "The Matrix");
    pick(2, 604, "The Matrix Reloaded");
    inLibrary[603] = [{ hasFile: true }];
    inLibrary[604] = [{ hasFile: false }];
    radarr();
    const result = await confirmSelectedChoices({ chosenIndexes: [1, 2] });
    assert.equal(posts().length, 0);
    assert.match(text(result), /The Matrix \(1999\) \[TMDb: 603\] - already in Radarr \(already downloaded\); not added again/);
    assert.match(text(result), /Reloaded.* - already in Radarr \(monitored but not downloaded yet\)/);
  });

  it("one failure doesn't stop the others, and Radarr's validation message is shown", async () => {
    pick(1, 603, "The Matrix");
    pick(2, 604, "The Matrix Reloaded");
    radarr((req) => {
      if (req.method === "post" && (req.body as any).tmdbId === 603) return { status: 400, data: [{ errorMessage: "Path is already configured for an existing movie" }] };
      return undefined;
    });
    const result = await confirmSelectedChoices({ chosenIndexes: [1, 2] });
    assert.match(text(result), /❌ \*\*Choice 1\*\*.* - failed: Path is already configured for an existing movie/);
    assert.match(text(result), /✅ \*\*Choice 2\*\*.* - added/);
    assert.equal(posts().length, 2);
  });

  it("ignores choice numbers that aren't in the last grid, and fails clearly when none are", async () => {
    pick(1, 603, "The Matrix");
    radarr();
    const partial = await confirmSelectedChoices({ chosenIndexes: [1, 99] });
    assert.equal(posts().length, 1);
    assert.doesNotMatch(text(partial), /Choice 99/);

    const none = await confirmSelectedChoices({ chosenIndexes: [99] });
    assert.equal(none.isError, true);
    assert.match(text(none), /do not exist in the current interface view context/);
    assert.equal(posts().length, 1, "nothing more was added");
  });

  it("reports a Radarr outage as an error", async () => {
    pick(1, 603, "The Matrix");
    radarr(() => ({ status: 503 }));
    const result = await confirmSelectedChoices({ chosenIndexes: [1] });
    assert.equal(result.isError, true);
    assert.match(text(result), /Execution failed during confirmation/);
  });
});
