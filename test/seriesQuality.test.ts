import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sonarrClient } from "../src/clients.js";
import { findSeriesByQuality, resetQualityCache } from "../src/tools/seriesQuality.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb } from "./helpers.js";

let sonarr: ReturnType<typeof fakeApi>;
let allSeries: any[];
let files: Record<number, any[]>;
let inFlight = 0;
let maxInFlight = 0;
const NOW = Date.parse("2026-09-19T15:00:00Z");

const series = (id: number, title: string, extra: Record<string, unknown> = {}) => ({ id, title, year: 2010, monitored: true, statistics: { episodeFileCount: 10 }, ...extra });
const file = (resolution: number | undefined, name = "x") => ({ quality: { quality: { resolution, name } } });
const many = (resolution: number | undefined, n: number) => Array.from({ length: n }, () => file(resolution));

function sonarrFake(overrides?: (url: string, params: Record<string, unknown>) => any) {
  sonarr = fakeApi(sonarrClient, async (req) => {
    const custom = overrides?.(req.url, req.params);
    if (custom) return custom;
    if (req.url === "/api/v3/series") return { data: allSeries };
    if (req.url === "/api/v3/episodefile") {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return { data: files[Number(req.params.seriesId)] ?? [] };
    }
    return { status: 404 };
  });
}

beforeEach(async () => {
  await resetDb();
  resetQualityCache();
  setSetting("SONARR_URL", "http://sonarr:8989");
  inFlight = 0;
  maxInFlight = 0;
  allSeries = [
    series(1, "Only 720", { monitored: false, path: "/media/tvshows/Only 720" }),
    series(2, "Mixed Show", { path: "/media/tvshowskids/Mixed Show" }),
    series(3, "Full 1080"),
    series(4, "Old SD", { monitored: false, path: "/media/tvshowskids/Old SD" }),
    series(5, "No Files", { statistics: { episodeFileCount: 0 } }),
    series(6, "Has 4K"),
    series(7, "Unknown Quality"),
  ];
  files = {
    1: [...many(720, 30)],
    2: [...many(1080, 5), ...many(720, 20), ...many(480, 2)],
    3: [...many(1080, 12)],
    4: [...many(480, 8)],
    6: [...many(2160, 3), ...many(1080, 3)],
    7: [...many(undefined, 4)],
  };
});
afterEach(() => sonarr?.restore());

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => (r.structuredContent?.media ?? []) as any[];
const titles = (r: any) => rows(r).map((m) => m.title);
const lines = (r: any) => text(r).split("\n").filter((l) => l.startsWith("- "));
const q = (options: Parameters<typeof findSeriesByQuality>[0] = {}) => findSeriesByQuality(options, NOW);

describe("find_series_by_quality", () => {
  it("says so when Sonarr isn't configured, without calling it", async () => {
    setSetting("SONARR_URL", "");
    sonarrFake();
    const result = await q();
    assert.equal(result.isError, true);
    assert.equal(sonarr.calls.length, 0);
  });

  it("opens with how many shows are at each best quality and how many mix resolutions", async () => {
    sonarrFake();
    const out = text(await q());
    assert.match(out, /6 shows have files\. By best quality: 2160p 1, 1080p 2, 720p 1, below 720p 1, unknown 1\. 2 mix resolutions\./);
    assert.match(out, /a 4K copy in Plex's 4K libraries that Sonarr does not manage is not seen here \(use search_plex_library with library '4k'\)/);
  });

  it("lists lowest best quality first, then bigger collections, with the count at each resolution", async () => {
    sonarrFake();
    assert.deepEqual(lines(await q()), [
      "- Unknown Quality (2010) - best unknown: unknown x4 - monitored",
      "- Old SD (2010) - best 480p: 480p x8 - not monitored",
      "- Only 720 (2010) - best 720p: 720p x30 - not monitored",
      "- Mixed Show (2010) - best 1080p: 1080p x5, 720p x20, 480p x2 - monitored",
      "- Full 1080 (2010) - best 1080p: 1080p x12 - monitored",
      "- Has 4K (2010) - best 2160p: 2160p x3, 1080p x3 - monitored",
    ]);
  });

  it("bestAtMost finds the shows topping out at that quality or below (720p only)", async () => {
    sonarrFake();
    const result = await q({ bestAtMost: 720 });
    assert.deepEqual(titles(result), ["Old SD", "Only 720"]);
    assert.match(text(result), /Matching \(best at most 720p\): 2 shows\./);
  });

  it("bestAtLeast finds shows with that quality or better", async () => {
    sonarrFake();
    assert.deepEqual(titles(await q({ bestAtLeast: 1080 })), ["Mixed Show", "Full 1080", "Has 4K"]);
    assert.deepEqual(titles(await q({ bestAtLeast: 2160 })), ["Has 4K"]);
    assert.deepEqual(titles(await q({ bestAtLeast: 720, bestAtMost: 720 })), ["Only 720"]);
  });

  it("mixedOnly finds shows whose files are not all one resolution", async () => {
    sonarrFake();
    assert.deepEqual(new Set(titles(await q({ mixedOnly: true }))), new Set(["Mixed Show", "Has 4K"]));
    assert.deepEqual(titles(await q({ mixedOnly: true, bestAtMost: 1080 })), ["Mixed Show"]);
  });

  it("leaves shows with no known resolution out of resolution filters", async () => {
    sonarrFake();
    assert.equal(titles(await q({ bestAtMost: 4000 })).includes("Unknown Quality"), false);
    assert.equal(titles(await q({ bestAtLeast: 1 })).includes("Unknown Quality"), false);
    assert.equal(titles(await q({ mixedOnly: true })).includes("Unknown Quality"), false);
  });

  it("filters by whether Sonarr monitors the show", async () => {
    sonarrFake();
    assert.deepEqual(titles(await q({ monitored: "unmonitored" })), ["Old SD", "Only 720"]);
    assert.equal(titles(await q({ monitored: "monitored" })).length, 4);
    assert.equal(titles(await q({ monitored: "any" })).length, 6);
  });

  it("folder narrows to shows whose Sonarr path contains the text, ignoring case", async () => {
    sonarrFake();
    assert.deepEqual(titles(await q({ folder: "KIDS" })), ["Old SD", "Mixed Show"]);
    assert.deepEqual(titles(await q({ folder: "kids", bestAtMost: 480 })), ["Old SD"]);
    assert.match(text(await q({ folder: "  kids " })), /Matching \(in folders matching "kids"\): 2 shows\./);
    assert.equal(titles(await q({ folder: "  " })).length, 6, "a blank folder is no filter");
    assert.deepEqual(titles(await q({ folder: "anime" })), []);
  });

  it("does not read the files of a show that has none", async () => {
    sonarrFake();
    await q();
    const asked = sonarr.calls.filter((c) => c.url === "/api/v3/episodefile").map((c) => c.params.seriesId).sort();
    assert.deepEqual(asked, [1, 2, 3, 4, 6, 7]);
  });

  it("reads files a few at a time, not all at once", async () => {
    allSeries = Array.from({ length: 40 }, (_, i) => series(i + 1, `Show ${i + 1}`));
    files = Object.fromEntries(allSeries.map((s) => [s.id, many(720, 2)]));
    sonarrFake();
    await q({ limit: 100 });
    assert.ok(maxInFlight > 1 && maxInFlight <= 8, `saw ${maxInFlight} in flight`);
  });

  it("caches the summary for five minutes so a follow-up question does not read Sonarr again", async () => {
    sonarrFake();
    await findSeriesByQuality({ bestAtMost: 720 }, NOW);
    const first = sonarr.calls.length;
    await findSeriesByQuality({ bestAtLeast: 1080 }, NOW + 4 * 60_000);
    assert.equal(sonarr.calls.length, first, "served from the cache");
    await findSeriesByQuality({}, NOW + 6 * 60_000);
    assert.ok(sonarr.calls.length > first, "after five minutes it reads again");
    resetQualityCache();
    const before = sonarr.calls.length;
    await q();
    assert.ok(sonarr.calls.length > before, "the reset hook clears it");
  });

  it("limits the list and says how many were left out", async () => {
    sonarrFake();
    const result = await q({ limit: 2 });
    assert.equal(rows(result).length, 2);
    assert.match(text(result), /Listed the 2 with the lowest best quality \(then the most files\); 4 more are not listed/);
    assert.equal(rows(await q({ limit: 0 })).length, 1);
  });

  it("breaks a tie on quality and file count alphabetically", async () => {
    allSeries = [series(1, "Zed"), series(2, "Alpha"), series(3, "Mid")];
    files = { 1: many(720, 5), 2: many(720, 5), 3: many(720, 5) };
    sonarrFake();
    assert.deepEqual(titles(await q()), ["Alpha", "Mid", "Zed"]);
  });

  it("never lists more than 200 shows, whatever limit is asked for", async () => {
    allSeries = Array.from({ length: 210 }, (_, i) => series(i + 1, `Show ${String(i).padStart(3, "0")}`));
    files = Object.fromEntries(allSeries.map((s) => [s.id, many(720, 1)]));
    sonarrFake();
    assert.equal(rows(await q({ limit: 500 })).length, 200);
  });

  it("returns table rows with the quality breakdown", async () => {
    sonarrFake();
    assert.deepEqual(rows(await q({ bestAtMost: 480 })), [
      { kind: "show", title: "Old SD", year: 2010, posterUrl: null, libraries: null, genres: [], rating: null, detail: "best 480p: 480p x8" },
    ]);
  });

  it("says so, with the totals, when nothing matches", async () => {
    sonarrFake();
    const result = await q({ bestAtLeast: 4320 });
    assert.match(text(result), /Matching \(best at least 4320p\): 0 shows\./);
    assert.equal((result as any).structuredContent, undefined);
  });

  it("rejects a resolution that cannot be right, or a range that cannot match", async () => {
    sonarrFake();
    for (const [args, re] of [[{ bestAtMost: 0 }, /bestAtMost must be a resolution/], [{ bestAtLeast: -1 }, /bestAtLeast must be a resolution/], [{ bestAtLeast: 1080, bestAtMost: 720 }, /bestAtLeast is above bestAtMost/]] as const) {
      const result = await q(args);
      assert.equal(result.isError, true);
      assert.match(text(result), re);
    }
    assert.equal(sonarr.calls.length, 0);
  });

  it("fails as a whole if any show's files can't be read, and does not cache the failure", async () => {
    sonarrFake((url, params) => (url === "/api/v3/episodefile" && params.seriesId === 3 ? { status: 500 } : undefined));
    const result = await q();
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to check Sonarr/);
    sonarr.restore();
    sonarrFake();
    assert.equal((await q()).isError, undefined, "the next call tries again");
  });
});
