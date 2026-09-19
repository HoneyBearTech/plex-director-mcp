import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sonarrClient } from "../src/clients.js";
import { checkSeriesStatus, describeQueueItem, diagnoseMissingEpisodes, storyOf } from "../src/tools/seriesDiagnosis.js";
import { setSetting } from "../src/settings.js";
import { fakeApi, resetDb } from "./helpers.js";

const PAST = "2001-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";
// A real Sonarr history record carries the release's download URL, which holds
// the indexer API key. It must never come out of the tools.
const SECRET = "SUPERSECRETAPIKEY123";
const POISON = {
  downloadUrl: `https://prowlarr.example/3/download?apikey=${SECRET}&link=abc`,
  guid: `https://indexer.example/details?guid=${SECRET}`,
  nzbInfoUrl: `https://indexer.example/geekseek.php?guid=${SECRET}`,
};

let sonarr: ReturnType<typeof fakeApi>;
let allSeries: any[];
let episodes: any[];
let history: any[];
let queue: any[];
let files: any[];
let profiles: any[];

const series = (extra: Record<string, unknown> = {}) => ({
  id: 1,
  title: "Bluey (2018)",
  year: 2018,
  status: "continuing",
  monitored: true,
  network: "ABC Kids",
  seriesType: "standard",
  certification: "TV-G",
  runtime: 7,
  qualityProfileId: 8,
  path: "/media/tvshowskids/Bluey (2018)",
  monitorNewItems: "all",
  firstAired: "2018-10-01T00:00:00Z",
  lastAired: "2024-04-21T00:00:00Z",
  alternateTitles: [],
  images: [{ coverType: "poster", url: "/MediaCover/1/poster.jpg?lastWrite=1", remoteUrl: "https://artworks.example/poster.jpg" }],
  statistics: { totalEpisodeCount: 999, episodeFileCount: 0, sizeOnDisk: 10_890_252_785 },
  ...extra,
});

let nextId = 100;
const ep = (season: number, number: number, extra: Record<string, unknown> = {}) => ({
  id: nextId++,
  seasonNumber: season,
  episodeNumber: number,
  title: `Ep ${season}-${number}`,
  hasFile: false,
  monitored: true,
  airDateUtc: PAST,
  episodeFileId: 0,
  ...extra,
});
const record = (episodeId: number, eventType: string, date: string, extra: Record<string, unknown> = {}) => ({
  episodeId,
  seriesId: 1,
  eventType,
  date,
  sourceTitle: `Release.For.${episodeId}`,
  data: { ...POISON },
  ...extra,
});

function sonarrFake(overrides?: (url: string, params: Record<string, unknown>) => any) {
  sonarr = fakeApi(sonarrClient, (req) => {
    const custom = overrides?.(req.url, req.params);
    if (custom) return custom;
    if (req.url === "/api/v3/series") return { data: allSeries };
    if (req.url === "/api/v3/episode") return { data: episodes };
    if (req.url === "/api/v3/history/series") return { data: history };
    if (req.url === "/api/v3/queue") return { data: { totalRecords: queue.length, records: queue } };
    if (req.url === "/api/v3/episodefile") return { data: files };
    if (req.url === "/api/v3/qualityprofile") return { data: profiles };
    return { status: 404 };
  });
}

beforeEach(async () => {
  await resetDb();
  setSetting("SONARR_URL", "http://sonarr:8989");
  nextId = 100;
  allSeries = [series()];
  episodes = [];
  history = [];
  queue = [];
  files = [];
  profiles = [{ id: 5, name: "WEB-DL (1080p)" }, { id: 8, name: "WEB-DL (1080p) - Old Series/Kids" }];
});
afterEach(() => sonarr?.restore());

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const rows = (r: any) => r.structuredContent.media as Array<Record<string, any>>;
const calls = (url: string) => sonarr.calls.filter((c) => c.url === url);
const everything = (r: any) => JSON.stringify(r);

describe("describeQueueItem", () => {
  it("reports progress and time left while downloading", () => {
    assert.equal(describeQueueItem({ trackedDownloadState: "downloading", size: 1000, sizeleft: 580, timeleft: "00:12:33" }), "downloading 42%, about 00:12:33 left");
    assert.equal(describeQueueItem({ trackedDownloadState: "downloading", size: 0 }), "downloading");
  });
  it("says when it is paused, waiting to import, blocked, failed or ignored, with the reason", () => {
    assert.equal(describeQueueItem({ trackedDownloadState: "downloading", status: "paused", size: 100, sizeleft: 50 }), "paused at 50%");
    assert.equal(describeQueueItem({ trackedDownloadState: "importPending" }), "downloaded, waiting to be imported");
    assert.equal(describeQueueItem({ trackedDownloadState: "importing" }), "downloaded, waiting to be imported");
    assert.equal(
      describeQueueItem({ trackedDownloadState: "importBlocked", statusMessages: [{ title: "Bluey S03E11", messages: ["No files found are eligible for import"] }] }),
      "downloaded but the import is blocked: No files found are eligible for import"
    );
    assert.equal(describeQueueItem({ trackedDownloadState: "failed", errorMessage: "Repair failed" }), "the download failed: Repair failed");
    assert.equal(describeQueueItem({ trackedDownloadState: "failedPending" }), "the download failed");
    assert.equal(describeQueueItem({ trackedDownloadState: "ignored" }), "ignored");
  });
  it("falls back to the raw status, and clamps a size left bigger than the size", () => {
    assert.equal(describeQueueItem({ status: "queued" }), "queued");
    assert.equal(describeQueueItem({}), "in the queue");
    assert.equal(describeQueueItem({ trackedDownloadState: "downloading", size: 100, sizeleft: 400 }), "downloading 0%");
  });
});

describe("storyOf", () => {
  it("is 'never' with no history", () => {
    assert.deepEqual(storyOf([]), { kind: "never" });
  });

  it("uses the most recent relevant event, whatever order the records arrive in", () => {
    const records = [
      record(1, "grabbed", "2024-01-01T00:00:00Z", { data: { indexer: "NZBgeek (Prowlarr)" } }),
      record(1, "downloadFailed", "2024-03-01T00:00:00Z", { data: { message: "Repair failed" } }),
      record(1, "downloadIgnored", "2024-02-01T00:00:00Z", { data: { message: "Manually ignored" } }),
    ];
    assert.deepEqual(storyOf(records), { kind: "failed", date: "2024-03-01", message: "Repair failed", release: "Release.For.1" });
    assert.deepEqual(storyOf([...records].reverse()), storyOf(records));
  });

  it("reads a deleted file's reason, a grab's indexer, an ignore's message and an old import", () => {
    assert.deepEqual(storyOf([record(1, "episodeFileDeleted", "2025-03-12T20:00:08Z", { data: { reason: "MissingFromDisk" } })]), { kind: "deleted", date: "2025-03-12", reason: "MissingFromDisk" });
    assert.deepEqual(storyOf([record(1, "grabbed", "2024-01-01T00:00:00Z", { data: { indexer: "NZBgeek (Prowlarr)" } })]), { kind: "grabbed", date: "2024-01-01", release: "Release.For.1", indexer: "NZBgeek (Prowlarr)" });
    assert.deepEqual(storyOf([record(1, "downloadIgnored", "2024-01-01T00:00:00Z", { data: { message: "Manually ignored" } })]), { kind: "ignored", date: "2024-01-01", message: "Manually ignored" });
    assert.deepEqual(storyOf([record(1, "downloadFolderImported", "2024-01-01T00:00:00Z")]), { kind: "imported", date: "2024-01-01" });
  });

  it("ignores events that say nothing about whether it was obtained (renames, etc.)", () => {
    const records = [record(1, "grabbed", "2024-01-01T00:00:00Z"), record(1, "episodeFileRenamed", "2025-01-01T00:00:00Z"), record(1, "seriesFolderImported", "2025-06-01T00:00:00Z")];
    assert.equal(storyOf(records).kind, "grabbed");
    assert.deepEqual(storyOf([record(1, "episodeFileRenamed", "2025-01-01T00:00:00Z")]), { kind: "never" });
  });

  it("puts the download queue above any history", () => {
    assert.deepEqual(storyOf([record(1, "downloadFailed", "2024-03-01T00:00:00Z")], { trackedDownloadState: "importPending" }), { kind: "queued", note: "downloaded, waiting to be imported" });
  });

  it("copes with missing data", () => {
    assert.deepEqual(storyOf([{ eventType: "downloadFailed", date: "2024-03-01T00:00:00Z" }]), { kind: "failed", date: "2024-03-01", message: null, release: null });
    assert.deepEqual(storyOf([{ eventType: "episodeFileDeleted", date: "2024-03-01T00:00:00Z", data: { reason: "  " } }]), { kind: "deleted", date: "2024-03-01", reason: null });
  });
});

describe("diagnose_missing_episodes", () => {
  it("says so when Sonarr isn't configured, without calling it", async () => {
    setSetting("SONARR_URL", "");
    sonarrFake();
    const result = await diagnoseMissingEpisodes("Bluey");
    assert.equal(result.isError, true);
    assert.equal(sonarr.calls.length, 0);
  });

  it("explains a file that was removed from disk, and that an unmonitored episode will not come back (Bluey S3E11)", async () => {
    const missing = ep(3, 11, { title: "Chest", monitored: false });
    episodes = [ep(3, 10, { hasFile: true }), missing];
    history = [
      record(missing.id, "downloadFolderImported", "2024-08-18T18:33:58Z"),
      record(missing.id, "episodeFileRenamed", "2025-02-08T17:53:48Z"),
      record(missing.id, "episodeFileDeleted", "2025-03-12T20:00:08Z", { data: { reason: "MissingFromDisk", ...POISON } }),
    ];
    sonarrFake();
    const result = await diagnoseMissingEpisodes("bluey");
    assert.match(text(result), /^## Bluey \(2018\) - monitored in Sonarr/);
    assert.match(text(result), /1 aired episode has no file\./);
    assert.match(text(result), /- 1 episode: the file was removed\. Sonarr will not look for it because these episodes are not monitored; turn monitoring on in Sonarr to have it searched\. S3E11 "Chest" \(removed 2025-03-12: MissingFromDisk\)\./);
  });

  it("says the show is not monitored when that is the reason", async () => {
    allSeries = [series({ monitored: false })];
    episodes = [ep(1, 1), ep(1, 2)];
    sonarrFake();
    assert.match(text(await diagnoseMissingEpisodes("Bluey")), /Sonarr will not look for them because the show is not monitored/);
  });

  it("for an unsearched monitored episode says Sonarr has not searched yet; with a last search date, when", async () => {
    episodes = [ep(1, 1)];
    sonarrFake();
    assert.match(text(await diagnoseMissingEpisodes("Bluey")), /never downloaded \(nothing has ever been grabbed\)\. Sonarr is monitoring it but has never searched for it; it only finds older episodes when a release turns up in an RSS sync, so running a search for missing episodes in Sonarr would look now\./);
    sonarr.restore();
    episodes = [ep(1, 1, { lastSearchTime: "2024-11-03T03:56:37Z" }), ep(1, 2, { lastSearchTime: "2025-02-01T00:00:00Z" })];
    sonarrFake();
    assert.match(text(await diagnoseMissingEpisodes("Bluey")), /Sonarr is monitoring them and last searched on 2025-02-01 without finding a usable release; check the indexers and the quality profile\./);
  });

  it("explains a failed download with Sonarr's own message", async () => {
    const missing = ep(1, 13, { title: "Wolves at the Door" });
    episodes = [missing];
    history = [record(missing.id, "grabbed", "2026-09-14T22:00:00Z"), record(missing.id, "downloadFailed", "2026-09-14T23:25:40Z", { data: { message: "Repair failed, not enough repair blocks (1 short)" } })];
    sonarrFake();
    const out = text(await diagnoseMissingEpisodes("Bluey"));
    assert.match(out, /the last download attempt failed\. Sonarr is monitoring it, so it will search again\./);
    assert.match(out, /S1E13 "Wolves at the Door" \(failed 2026-09-14: Repair failed, not enough repair blocks \(1 short\)\)/);
  });

  it("explains a release that was grabbed but never imported", async () => {
    const missing = ep(2, 4);
    episodes = [missing];
    history = [record(missing.id, "grabbed", "2026-09-10T08:00:00Z", { sourceTitle: "Bluey.S02E04.1080p.WEB-DL-NTb", data: { indexer: "NZBgeek (Prowlarr)", ...POISON } })];
    sonarrFake();
    assert.match(text(await diagnoseMissingEpisodes("Bluey")), /a release was grabbed but never imported\..*S2E04 "Ep 2-4" \(grabbed 2026-09-10: Bluey\.S02E04\.1080p\.WEB-DL-NTb\)/);
  });

  it("explains ignored releases and files that were imported once but are gone", async () => {
    const a = ep(1, 1);
    const b = ep(1, 2);
    episodes = [a, b];
    history = [record(a.id, "downloadIgnored", "2026-01-01T00:00:00Z", { data: { message: "Manually ignored" } }), record(b.id, "downloadFolderImported", "2025-01-01T00:00:00Z")];
    sonarrFake();
    const out = text(await diagnoseMissingEpisodes("Bluey"));
    assert.match(out, /the release that was found was ignored\..*ignored 2026-01-01: Manually ignored/);
    assert.match(out, /it was imported once, but the file is gone\..*imported 2025-01-01/);
  });

  it("shows what the download queue says for an episode that is in it, and leaves it to Sonarr", async () => {
    const queued = ep(3, 1);
    episodes = [queued];
    queue = [
      { seriesId: 1, episodeId: queued.id, trackedDownloadState: "importBlocked", statusMessages: [{ title: "x", messages: ["No files found are eligible for import"] }] },
      { seriesId: 999, episodeId: queued.id, trackedDownloadState: "downloading" },
    ];
    sonarrFake();
    const out = text(await diagnoseMissingEpisodes("Bluey"));
    assert.match(out, /in the download queue\. Sonarr is already handling it\. .*downloaded but the import is blocked: No files found are eligible for import/);
    assert.equal(calls("/api/v3/queue").length, 1);
  });

  it("groups episodes by situation, biggest first, and shortens long lists", async () => {
    const failed = ep(1, 1);
    const never = Array.from({ length: 7 }, (_, i) => ep(2, i + 1, { monitored: false }));
    episodes = [failed, ...never];
    history = [record(failed.id, "downloadFailed", "2026-01-01T00:00:00Z", { data: { message: "boom" } })];
    sonarrFake();
    const out = text(await diagnoseMissingEpisodes("Bluey"));
    const lines = out.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^- 7 episodes: never downloaded .* S2E01 "Ep 2-1"; S2E02 "Ep 2-2"; S2E03 "Ep 2-3"; S2E04 "Ep 2-4"; and 3 more\.$/);
    assert.match(lines[1]!, /^- 1 episode: the last download attempt failed\./);
    assert.match(out, /8 aired episodes have no file\./);
  });

  it("separates the same situation by whether Sonarr would search", async () => {
    episodes = [ep(1, 1, { monitored: true }), ep(1, 2, { monitored: false })];
    sonarrFake();
    const lines = text(await diagnoseMissingEpisodes("Bluey")).split("\n").filter((l) => l.startsWith("- "));
    assert.equal(lines.length, 2);
    assert.ok(lines.some((l) => /Sonarr is monitoring it/.test(l)) && lines.some((l) => /will not look for it because these episodes are not monitored/.test(l)));
  });

  it("caps the number of situations listed", async () => {
    // 8 distinct situations: 7 event kinds x monitoring is more than the cap of 6.
    const eps = Array.from({ length: 8 }, (_, i) => ep(1, i + 1, { monitored: i % 2 === 0 }));
    episodes = eps;
    history = [
      record(eps[0]!.id, "downloadFailed", "2026-01-01T00:00:00Z"),
      record(eps[1]!.id, "downloadFailed", "2026-01-01T00:00:00Z"),
      record(eps[2]!.id, "grabbed", "2026-01-01T00:00:00Z"),
      record(eps[3]!.id, "grabbed", "2026-01-01T00:00:00Z"),
      record(eps[4]!.id, "downloadIgnored", "2026-01-01T00:00:00Z"),
      record(eps[5]!.id, "downloadIgnored", "2026-01-01T00:00:00Z"),
      record(eps[6]!.id, "episodeFileDeleted", "2026-01-01T00:00:00Z"),
      record(eps[7]!.id, "episodeFileDeleted", "2026-01-01T00:00:00Z"),
    ];
    sonarrFake();
    const out = text(await diagnoseMissingEpisodes("Bluey"));
    assert.equal(out.split("\n").filter((l) => l.startsWith("- ") && !l.includes("other situations")).length, 6);
    assert.match(out, /- 2 more episodes across 2 other situations\./);
  });

  it("never treats specials, unaired episodes, or episodes with a file as missing", async () => {
    episodes = [ep(0, 1), ep(1, 1, { hasFile: true }), ep(1, 2, { airDateUtc: FUTURE }), ep(1, 3)];
    sonarrFake();
    assert.match(text(await diagnoseMissingEpisodes("Bluey")), /1 aired episode has no file\./);
  });

  it("says nothing is missing when nothing is", async () => {
    episodes = [ep(1, 1, { hasFile: true })];
    sonarrFake();
    assert.match(text(await diagnoseMissingEpisodes("Bluey")), /Nothing is missing: every aired episode has a file\./);
    assert.equal(((await diagnoseMissingEpisodes("Bluey")) as any).structuredContent, undefined);
  });

  describe("season and episode", () => {
    beforeEach(() => {
      episodes = [ep(1, 1, { hasFile: true }), ep(1, 2), ep(2, 1), ep(2, 2, { hasFile: true }), ep(2, 3, { airDateUtc: FUTURE, title: "Coming" })];
    });

    it("looks at one season only, and asks Sonarr's history for that season only", async () => {
      sonarrFake();
      const result = await diagnoseMissingEpisodes("Bluey", { season: 2 });
      assert.match(text(result), /1 aired episode has no file in season 2\./);
      assert.match(text(result), /S2E01/);
      assert.doesNotMatch(text(result), /S1E02/);
      assert.equal(calls("/api/v3/history/series")[0]!.params.seasonNumber, 2);
    });

    it("diagnoses one episode", async () => {
      sonarrFake();
      const result = await diagnoseMissingEpisodes("Bluey", { season: 1, episode: 2 });
      assert.match(text(result), /1 aired episode has no file in season 1\./);
      assert.match(text(result), /S1E02 "Ep 1-2"/);
    });

    it("says so when the episode is not missing: it has a file, or has not aired", async () => {
      sonarrFake();
      assert.match(text(await diagnoseMissingEpisodes("Bluey", { season: 1, episode: 1 })), /S1E01 "Ep 1-1" is not missing: Sonarr has a file for it\./);
      assert.match(text(await diagnoseMissingEpisodes("Bluey", { season: 2, episode: 3 })), /S2E03 "Coming" has not aired yet \(it airs 2999-01-01\), so it is not missing\./);
    });

    it("says so for a season or episode Sonarr does not have, and needs a season with an episode", async () => {
      sonarrFake();
      assert.match(text(await diagnoseMissingEpisodes("Bluey", { season: 9 })), /has no season 9 in Sonarr/);
      assert.match(text(await diagnoseMissingEpisodes("Bluey", { season: 1, episode: 99 })), /Sonarr has no S1E99/);
      const noSeason = await diagnoseMissingEpisodes("Bluey", { episode: 3 });
      assert.equal(noSeason.isError, true);
      assert.match(text(noSeason), /give its season number/);
    });

    it("says nothing is missing from a complete season", async () => {
      episodes = [ep(1, 1, { hasFile: true })];
      sonarrFake();
      assert.match(text(await diagnoseMissingEpisodes("Bluey", { season: 1 })), /Nothing is missing from season 1/);
    });
  });

  it("fetches history and queue once, not once per episode", async () => {
    episodes = Array.from({ length: 30 }, (_, i) => ep(1, i + 1));
    sonarrFake();
    await diagnoseMissingEpisodes("Bluey");
    assert.deepEqual([calls("/api/v3/history/series").length, calls("/api/v3/queue").length, calls("/api/v3/episode").length], [1, 1, 1]);
  });

  // The release URLs in Sonarr's history hold the indexer API key.
  it("never lets anything from a history record's raw data (download URLs, API keys) out", async () => {
    const eps = [ep(1, 1), ep(1, 2), ep(1, 3), ep(1, 4)];
    episodes = eps;
    history = [
      record(eps[0]!.id, "grabbed", "2026-01-01T00:00:00Z", { data: { indexer: "NZBgeek", ...POISON } }),
      record(eps[1]!.id, "downloadFailed", "2026-01-01T00:00:00Z", { data: { message: "boom", ...POISON } }),
      record(eps[2]!.id, "episodeFileDeleted", "2026-01-01T00:00:00Z", { data: { reason: "Manual", ...POISON } }),
      record(eps[3]!.id, "downloadIgnored", "2026-01-01T00:00:00Z", { data: { message: "no", ...POISON } }),
    ];
    sonarrFake();
    const result = await diagnoseMissingEpisodes("Bluey");
    assert.doesNotMatch(everything(result), new RegExp(`${SECRET}|apikey|downloadUrl|guid=`, "i"));
    assert.match(text(result), /grabbed 2026-01-01/, "the safe fields still come through");
  });

  it("asks which show when the title is ambiguous, and says when it is unknown", async () => {
    allSeries = [series({ id: 1, title: "Fargo", year: 2014 }), series({ id: 2, title: "Fargo", year: 2023 })];
    sonarrFake();
    assert.match(text(await diagnoseMissingEpisodes("Fargo")), /matches 2 series in Sonarr/);
    assert.equal(calls("/api/v3/history/series").length, 0);
    assert.match(text(await diagnoseMissingEpisodes("Nope")), /No series matching "Nope" in Sonarr\./);
  });

  it("returns a table row for the show", async () => {
    episodes = [ep(1, 1, { hasFile: true }), ep(1, 2, { monitored: false }), ep(1, 3, { monitored: false })];
    sonarrFake();
    const result = await diagnoseMissingEpisodes("Bluey");
    assert.deepEqual(rows(result), [
      {
        kind: "show",
        title: "Bluey (2018)",
        year: 2018,
        posterUrl: null,
        libraries: null,
        genres: [],
        rating: null,
        detail: "2 missing: never downloaded (nothing has ever been grabbed), not monitored",
        show: { seasons: 1, episodes: 3, watchedEpisodes: null, ownedEpisodes: 1, network: "ABC Kids" },
      },
    ]);
  });

  it("reports a Sonarr outage as an error, and any single failed lookup fails the whole answer", async () => {
    sonarrFake(() => ({ status: 500 }));
    const result = await diagnoseMissingEpisodes("Bluey");
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to check Sonarr/);
    sonarr.restore();
    episodes = [ep(1, 1)];
    sonarrFake((url) => (url === "/api/v3/queue" ? { status: 500 } : undefined));
    assert.equal((await diagnoseMissingEpisodes("Bluey")).isError, true);
  });
});

describe("check_series_status", () => {
  const file = (id: number, dateAdded: string, extra: Record<string, unknown> = {}) => ({ id, dateAdded, quality: { quality: { name: "WEBDL-1080p" } }, releaseGroup: "NTb", ...extra });

  it("says so when Sonarr isn't configured", async () => {
    setSetting("SONARR_URL", "");
    sonarrFake();
    const result = await checkSeriesStatus("Bluey");
    assert.equal(result.isError, true);
    assert.equal(sonarr.calls.length, 0);
  });

  it("profiles the show: monitoring, quality profile, location, size, airing and last download", async () => {
    allSeries = [series({ nextAiring: "2999-01-08T02:00:00Z" })];
    const a = ep(1, 1, { hasFile: true, episodeFileId: 7 });
    const b = ep(1, 2, { hasFile: true, episodeFileId: 8 });
    const c = ep(1, 3);
    episodes = [a, b, c];
    files = [file(7, "2026-01-01T00:00:00Z"), file(8, "2026-08-01T08:03:00Z", { releaseGroup: "playWEB" })];
    sonarrFake();
    const out = text(await checkSeriesStatus("bluey"));
    assert.match(out, /^## Bluey \(2018\) - Sonarr: continuing, monitored\n/);
    assert.match(out, /Network: ABC Kids \| Type: standard \| Rated: TV-G \| Runtime: 7 min/);
    assert.match(out, /Quality profile: WEB-DL \(1080p\) - Old Series\/Kids/);
    assert.match(out, /Location: \/media\/tvshowskids\/Bluey \(2018\)/);
    assert.match(out, /Episodes: 2 of 3 aired episodes downloaded \(1 missing; use check_series_completeness for which\), across 1 season, 10\.9 GB on disk\./);
    assert.match(out, /New seasons: monitored automatically\./);
    assert.match(out, /Aired: first aired 2018-10-01, latest 2024-04-21\. Next episode airs 2999-01-08\./);
    assert.match(out, /Last download: 2026-08-01, S1E02 \(WEBDL-1080p, playWEB\)\./);
  });

  it("says when a show is complete, unmonitored, not scheduled, or has never downloaded anything", async () => {
    allSeries = [series({ monitored: false, status: "ended", monitorNewItems: "none" })];
    episodes = [ep(1, 1, { hasFile: true, episodeFileId: 7 })];
    files = [];
    sonarrFake();
    const out = text(await checkSeriesStatus("Bluey"));
    assert.match(out, /Sonarr: ended, not monitored/);
    assert.match(out, /Episodes: all 1 aired episodes downloaded, across 1 season/);
    assert.match(out, /New seasons: not monitored automatically\./);
    assert.match(out, /No upcoming episode is scheduled\./);
    assert.match(out, /Last download: nothing has been downloaded for this show\./);
  });

  it("names a quality profile it cannot find by its number, and copes with a show that has not aired", async () => {
    allSeries = [series({ qualityProfileId: 42 })];
    episodes = [ep(1, 1, { airDateUtc: FUTURE })];
    sonarrFake();
    const out = text(await checkSeriesStatus("Bluey"));
    assert.match(out, /Quality profile: profile #42/);
    assert.match(out, /Episodes: none have aired yet \(1 upcoming\)\./);
  });

  it("lists what is in the download queue for this show only", async () => {
    episodes = [ep(1, 1, { hasFile: true })];
    queue = [
      { seriesId: 1, episodeId: 1, trackedDownloadState: "downloading", size: 100, sizeleft: 25, timeleft: "00:01:00" },
      { seriesId: 1, episodeId: 2, trackedDownloadState: "importPending" },
      { seriesId: 5, episodeId: 3, trackedDownloadState: "failed" },
    ];
    sonarrFake();
    const out = text(await checkSeriesStatus("Bluey"));
    assert.match(out, /In the download queue now: 2 items\./);
    assert.match(out, /- downloading 75%, about 00:01:00 left/);
    assert.match(out, /- downloaded, waiting to be imported/);
    assert.doesNotMatch(out, /the download failed/);
  });

  it("returns a row with a public poster URL, never Sonarr's own media path", async () => {
    episodes = [ep(1, 1, { hasFile: true, episodeFileId: 7 }), ep(1, 2)];
    allSeries = [series({ genres: ["Animation", "Kids"], ratings: { value: 9.1 } })];
    sonarrFake();
    const [row] = rows(await checkSeriesStatus("Bluey"));
    assert.equal(row!.posterUrl, "https://artworks.example/poster.jpg");
    assert.deepEqual([row!.genres, row!.rating, row!.detail], [["Animation", "Kids"], 9.1, "1 episodes missing"]);
    assert.deepEqual(row!.show, { seasons: 1, episodes: 2, watchedEpisodes: null, ownedEpisodes: 1, network: "ABC Kids" });

    allSeries = [series({ images: [{ coverType: "poster", url: "/MediaCover/1/poster.jpg" }] })];
    assert.equal(rows(await checkSeriesStatus("Bluey"))[0]!.posterUrl, null, "a local /MediaCover path needs Sonarr's API key");
    for (const remoteUrl of ["/MediaCover/1/poster.jpg", "javascript:alert(1)", "//artworks.example/p.jpg", ""]) {
      allSeries = [series({ images: [{ coverType: "poster", remoteUrl }] })];
      assert.equal(rows(await checkSeriesStatus("Bluey"))[0]!.posterUrl, null, `not a public http(s) URL: ${remoteUrl}`);
    }
  });

  it("asks which show when ambiguous, and says when Sonarr doesn't have it", async () => {
    allSeries = [series({ id: 1, title: "Fargo", year: 2014 }), series({ id: 2, title: "Fargo", year: 2023 })];
    sonarrFake();
    assert.match(text(await checkSeriesStatus("Fargo")), /matches 2 series in Sonarr/);
    assert.match(text(await checkSeriesStatus("Zzz")), /No series matching "Zzz" in Sonarr\./);
  });

  it("reports a Sonarr outage as an error", async () => {
    sonarrFake(() => ({ status: 500 }));
    const result = await checkSeriesStatus("Bluey");
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to check Sonarr/);
  });

  it("never outputs anything from history data", async () => {
    episodes = [ep(1, 1, { hasFile: true, episodeFileId: 7 })];
    files = [file(7, "2026-01-01T00:00:00Z")];
    history = [record(100, "grabbed", "2026-01-01T00:00:00Z")];
    sonarrFake();
    assert.doesNotMatch(everything(await checkSeriesStatus("Bluey")), new RegExp(`${SECRET}|apikey`, "i"));
    assert.equal(calls("/api/v3/history/series").length, 0, "status does not even read history");
  });
});
