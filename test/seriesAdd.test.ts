import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { radarrClient, sonarrClient, tmdbClient } from "../src/clients.js";
import { db } from "../src/db.js";
import { CHANGE_RULES, ROUTES } from "../src/guidance.js";
import { server } from "../src/server.js";
import { getSetting, SECRET_SETTINGS_KEYS, setSetting } from "../src/settings.js";
import { confirmSelectedChoices, registerDiscoveryTools } from "../src/tools/discovery.js";
import { movieTools } from "../src/tools/movies.js";
import {
  confirmSelectedSeries,
  MONITOR_OPTIONS,
  registerSeriesAddTools,
  searchAndSelectSeries,
  SERIES_TYPES,
} from "../src/tools/seriesAdd.js";
import { SYSTEM_PROMPT } from "../src/web/chat.js";
import { fakeApi, resetDb, startApp, type FakeReply, type RecordedRequest } from "./helpers.js";

// Adding TV series to Sonarr (C1-C17): search_and_select_series and the two
// forms of confirm_selected_series, a preview and a confirmation. Sonarr,
// Radarr and TMDb are the suite's fakes; nothing here reaches a real service.

const repo = path.resolve(import.meta.dirname, "..");
const API_KEY = "sonarr-key-that-must-never-be-shown";

const PROFILES = [
  { id: 4, name: "WEB-1080p" },
  { id: 6, name: "WEB-2160p" },
  { id: 8, name: "Anime" },
];
const ROOTS = [{ path: "/media/tvshows" }, { path: "/media/tvshowskids/" }];

const lookupSeries = (
  tvdbId: number,
  title: string,
  year: number,
  extra: Record<string, unknown> = {},
) => ({
  title,
  year,
  tvdbId,
  network: "Network One",
  status: "continuing",
  overview: `About ${title}.`,
  remotePoster: `https://artworks.example.org/posters/${tvdbId}.jpg`,
  images: [
    { coverType: "poster", remoteUrl: `https://artworks.example.org/posters/${tvdbId}.jpg` },
  ],
  seasons: [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 1, monitored: true },
    { seasonNumber: 2, monitored: true },
  ],
  titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ...extra,
});

// What Sonarr's lookup knows.
const CATALOG = [
  lookupSeries(501, "Harbour Lights", 2019),
  lookupSeries(502, "Harbour Lights: Origins", 2021, {
    seasons: [{ seasonNumber: 1, monitored: true }],
  }),
  lookupSeries(503, "Harbour Nights", 2008, { status: "ended", network: "Network Two" }),
  lookupSeries(504, "The Harbour", 1999),
  lookupSeries(505, "Harbour Patrol", 2015),
  lookupSeries(506, "Harbour Six", 2023),
  lookupSeries(601, "Quiet Valley", 2020),
  lookupSeries(602, "Quiet Valley Stories", 2022),
];

let sonarr: ReturnType<typeof fakeApi>;
// The series Sonarr has.
let inSonarr: any[];
let profiles: typeof PROFILES;
let roots: typeof ROOTS;
// TVDB id -> what POST /series answers for that show instead of adding it.
let addErrors: Record<number, FakeReply>;
let sonarrDown: boolean;

function sonarrFake() {
  sonarr = fakeApi(sonarrClient, (req) => {
    if (sonarrDown) throw new Error("connect ECONNREFUSED");
    if (req.method === "get" && req.url === "/api/v3/series/lookup") {
      const term = String(req.params.term ?? "").toLowerCase();
      return { data: CATALOG.filter((s) => s.title.toLowerCase().includes(term)) };
    }
    if (req.method === "get" && req.url === "/api/v3/series") return { data: inSonarr };
    if (req.method === "get" && req.url === "/api/v3/qualityprofile") return { data: profiles };
    if (req.method === "get" && req.url === "/api/v3/rootfolder") return { data: roots };
    if (req.method === "post" && req.url === "/api/v3/series") {
      const body = req.body as { tvdbId: number; title: string };
      const failure = addErrors[body.tvdbId];
      if (failure) return failure;
      inSonarr.push({ id: 1000 + inSonarr.length, ...body });
      return { status: 201, data: body };
    }
    return { status: 404 };
  });
}

beforeEach(async () => {
  await resetDb();
  setSetting("SONARR_URL", "http://sonarr:8989");
  setSetting("SONARR_API_KEY", API_KEY);
  inSonarr = [];
  profiles = [...PROFILES];
  roots = [...ROOTS];
  addErrors = {};
  sonarrDown = false;
  sonarrFake();
});
afterEach(() => sonarr?.restore());

const text = (r: { content: Array<{ text: string }> }) => r.content[0]!.text;
const posts = () => sonarr.calls.filter((c) => c.method === "post");
const nonGets = () => sonarr.calls.filter((c) => c.method !== "get");
const added = () => posts().map((c) => (c.body as { title: string }).title);
const idOf = (r: { content: Array<{ text: string }> }) => {
  const match = /previewId "([0-9a-f-]{36})"/.exec(text(r));
  assert.ok(match, `the reply carries a previewId: ${text(r)}`);
  return match[1]!;
};
const grid = () =>
  db
    .prepare(
      "SELECT selection_index, tvdb_id, title, year FROM series_selection_context ORDER BY selection_index",
    )
    .all() as Array<{ selection_index: number; tvdb_id: number; title: string; year: string }>;
const previews = () =>
  db.prepare("SELECT id, payload FROM series_add_preview").all() as Array<{
    id: string;
    payload: string;
  }>;
const search = (query: string) => searchAndSelectSeries({ query });
// A search followed by a preview of the given numbers.
async function previewOf(query: string, chosenIndexes: number[], options = {}) {
  await search(query);
  return confirmSelectedSeries({ chosenIndexes, ...options });
}

describe("search_and_select_series", () => {
  it("C1: without Sonarr both tools answer with an error and ask nothing", async () => {
    setSetting("SONARR_URL", "");
    for (const result of [
      await search("harbour"),
      await confirmSelectedSeries({ chosenIndexes: [1] }),
      await confirmSelectedSeries({ previewId: "00000000-0000-4000-8000-000000000000" }),
    ]) {
      assert.equal(result.isError, true);
      assert.match(text(result), /Sonarr isn't configured/);
    }
    assert.equal(sonarr.calls.length, 0);
  });

  it("C2: it asks GET /api/v3/series/lookup with the query as term", async () => {
    await search("Quiet Valley");
    const [first] = sonarr.calls;
    assert.equal(`${first!.method} ${first!.url}`, "get /api/v3/series/lookup");
    assert.deepEqual(first!.params, { term: "Quiet Valley" });
  });

  it("C2: no result is a reply that says so, not an error, and the previous grid is cleared", async () => {
    await search("quiet valley");
    assert.equal(grid().length, 2);
    const result = await search("no such show anywhere");
    assert.equal(result.isError, undefined);
    assert.match(text(result), /No series matched "no such show anywhere"/);
    assert.deepEqual(grid(), []);
  });

  it("C3: the first five results replace the previous series grid", async () => {
    await search("quiet valley");
    await search("harbour");
    assert.deepEqual(
      grid().map((g) => [g.selection_index, g.tvdb_id, g.title, g.year]),
      [
        [1, 501, "Harbour Lights", "2019"],
        [2, 502, "Harbour Lights: Origins", "2021"],
        [3, 503, "Harbour Nights", "2008"],
        [4, 504, "The Harbour", "1999"],
        [5, 505, "Harbour Patrol", "2015"],
      ],
    );
  });

  it("C4: the reply is a numbered grid with poster, title and year, network, status, seasons without specials, and TVDB id", async () => {
    const result = await search("harbour");
    const rows = text(result)
      .split("\n")
      .filter((l) => l.startsWith("| **[ Choice"));
    assert.equal(rows.length, 5);
    assert.match(
      rows[0]!,
      /^\| \*\*\[ Choice 1 \]\*\* \| !\[Harbour Lights\]\(https:\/\/artworks\.example\.org\/posters\/501\.jpg\) \|/,
    );
    assert.match(rows[0]!, /\*\*Harbour Lights \(2019\)\*\*/);
    // Season 0 (specials) is not counted.
    assert.match(rows[0]!, /Network One · continuing · 2 seasons · TVDB ID: 501/);
    assert.match(rows[1]!, /1 season · TVDB ID: 502/);
    assert.match(rows[2]!, /Network Two · ended · 2 seasons · TVDB ID: 503/);
    assert.match(rows[4]!, /Choice 5/);
    assert.doesNotMatch(text(result), /Harbour Six/);
  });

  it("C4: the overview is cut to 180 characters with table cells escaped, and a missing poster is said", async () => {
    const original = CATALOG[6]!;
    CATALOG[6] = lookupSeries(601, "Quiet | Valley", 2020, {
      overview: `Pipes | and \\ backslashes. ${"x".repeat(300)}`,
      remotePoster: undefined,
      images: [],
    });
    try {
      const result = await search("valley");
      const row = text(result)
        .split("\n")
        .find((l) => l.includes("Choice 1"))!;
      assert.match(row, /\*No poster\*/);
      assert.match(row, /\*\*Quiet \\\| Valley \(2020\)\*\*/);
      assert.ok(row.includes("Pipes \\| and \\\\ backslashes."), row);
      const overview = row.slice(row.indexOf("Pipes"), row.lastIndexOf(" |"));
      assert.equal(overview.length, 183);
      assert.ok(overview.endsWith("..."));
      // The row still has exactly three cells.
      assert.equal(row.replace(/\\\\/g, "").replace(/\\\|/g, "").split("|").length, 5);
    } finally {
      CATALOG[6] = original;
    }
  });

  it("C4: a poster that is not an https address is not shown", async () => {
    const original = CATALOG[6]!;
    CATALOG[6] = lookupSeries(601, "Quiet Valley", 2020, {
      remotePoster: "http://plex:32400/library/metadata/1/thumb/1",
    });
    try {
      assert.match(
        text(await search("quiet valley"))
          .split("\n")
          .find((l) => l.includes("Choice 1"))!,
        /\*No poster\*/,
      );
    } finally {
      CATALOG[6] = original;
    }
  });

  it("C4: a show already in Sonarr is marked", async () => {
    inSonarr = [{ id: 1, title: "Harbour Nights", tvdbId: 503 }];
    const rows = text(await search("harbour"))
      .split("\n")
      .filter((l) => l.startsWith("| **[ Choice"));
    assert.match(rows[2]!, /Already in Sonarr/);
    for (const i of [0, 1, 3, 4]) assert.doesNotMatch(rows[i]!, /Already in Sonarr/);
  });

  it("C5: it sends only GET requests", async () => {
    await search("harbour");
    await search("nothing matches this");
    assert.ok(sonarr.calls.length >= 3);
    assert.deepEqual(nonGets(), []);
  });

  it("C1: Sonarr unreachable is an error reply, and nothing stays to confirm", async () => {
    await search("quiet valley");
    sonarrDown = true;
    const result = await search("harbour");
    assert.equal(result.isError, true);
    assert.match(text(result), /Failed to search Sonarr for series: connect ECONNREFUSED/);
    assert.deepEqual(grid(), []);
  });
});

describe("confirm_selected_series: the preview", () => {
  it("C6: when no chosen number is in the last series grid it is an error, and nothing is sent to Sonarr", async () => {
    await search("quiet valley");
    const before = sonarr.calls.length;
    const result = await confirmSelectedSeries({ chosenIndexes: [7, 9] });
    assert.equal(result.isError, true);
    assert.match(text(result), /None of those numbers is in the last series grid/);
    assert.equal(sonarr.calls.length, before);
    assert.deepEqual(previews(), []);

    // With no grid at all, too.
    await resetDb();
    setSetting("SONARR_URL", "http://sonarr:8989");
    assert.equal((await confirmSelectedSeries({ chosenIndexes: [1] })).isError, true);
    assert.equal(sonarr.calls.length, before);
  });

  it("C7: the quality profile is the one named, else the setting, else Sonarr's first (and the preview says so)", async () => {
    const first = await previewOf("quiet valley", [1]);
    assert.match(
      text(first),
      /Quality profile: WEB-1080p \(Sonarr's first profile, because no default is set on the Settings page\)/,
    );

    setSetting("SONARR_DEFAULT_QUALITY_PROFILE", "  web-2160p ");
    const saved = await confirmSelectedSeries({ chosenIndexes: [1] });
    assert.match(text(saved), /Quality profile: WEB-2160p\n/);

    const named = await confirmSelectedSeries({ chosenIndexes: [1], qualityProfile: "anime" });
    assert.match(text(named), /Quality profile: Anime\n/);
    await confirmSelectedSeries({ previewId: idOf(named) });
    assert.equal((posts()[0]!.body as any).qualityProfileId, 8);
  });

  it("C7: a profile name Sonarr doesn't have is an error listing the profiles, and nothing is added", async () => {
    const result = await previewOf("quiet valley", [1], { qualityProfile: "Ultra" });
    assert.equal(result.isError, true);
    assert.match(
      text(result),
      /No Sonarr quality profile named "Ultra"\. Available: WEB-1080p, WEB-2160p, Anime\./,
    );
    setSetting("SONARR_DEFAULT_QUALITY_PROFILE", "Deleted Profile");
    const saved = await confirmSelectedSeries({ chosenIndexes: [1] });
    assert.equal(saved.isError, true);
    assert.match(text(saved), /"Deleted Profile" \(that is the default set on the Settings page\)/);
    assert.deepEqual(posts(), []);
    assert.deepEqual(previews(), []);
  });

  it("C8: the root folder is the one named, else the setting, else Sonarr's first; trailing slashes are ignored", async () => {
    assert.match(text(await previewOf("quiet valley", [1])), /Root folder: \/media\/tvshows\n/);

    setSetting("SONARR_DEFAULT_ROOT_FOLDER", "/media/tvshowskids");
    assert.match(
      text(await confirmSelectedSeries({ chosenIndexes: [1] })),
      /Root folder: \/media\/tvshowskids\/\n/,
    );

    const named = await confirmSelectedSeries({
      chosenIndexes: [1],
      rootFolder: "/media/tvshows//",
    });
    assert.match(text(named), /Root folder: \/media\/tvshows\n/);
    await confirmSelectedSeries({ previewId: idOf(named) });
    assert.equal((posts()[0]!.body as any).rootFolderPath, "/media/tvshows");
  });

  it("C8: a folder that is not one of Sonarr's root folders is an error listing them, and nothing is added", async () => {
    const result = await previewOf("quiet valley", [1], { rootFolder: "/somewhere/else" });
    assert.equal(result.isError, true);
    assert.match(
      text(result),
      /No Sonarr root folder "\/somewhere\/else"\. Available: \/media\/tvshows, \/media\/tvshowskids\/\./,
    );
    setSetting("SONARR_DEFAULT_ROOT_FOLDER", "/gone");
    const saved = await confirmSelectedSeries({ chosenIndexes: [1] });
    assert.equal(saved.isError, true);
    assert.match(
      text(saved),
      /"\/gone" \(that is the default root folder saved on the Settings page\)/,
    );
    roots = [];
    setSetting("SONARR_DEFAULT_ROOT_FOLDER", "");
    assert.match(
      text(await confirmSelectedSeries({ chosenIndexes: [1] })),
      /no root folders configured/,
    );
    assert.deepEqual(posts(), []);
    assert.deepEqual(previews(), []);
  });

  it("C9: the series type is the one named, else the setting, else standard; a saved value outside the allowed ones is an error", async () => {
    assert.deepEqual([...SERIES_TYPES], ["standard", "daily", "anime"]);
    assert.match(text(await previewOf("quiet valley", [1])), /Series type: standard\n/);
    setSetting("SONARR_DEFAULT_SERIES_TYPE", "Daily");
    assert.match(text(await confirmSelectedSeries({ chosenIndexes: [1] })), /Series type: daily\n/);
    assert.match(
      text(await confirmSelectedSeries({ chosenIndexes: [1], seriesType: "anime" })),
      /Series type: anime\n/,
    );

    setSetting("SONARR_DEFAULT_SERIES_TYPE", "miniseries");
    const current = previews();
    const bad = await confirmSelectedSeries({ chosenIndexes: [1] });
    assert.equal(bad.isError, true);
    assert.match(
      text(bad),
      /"miniseries" is not a series type \(that is the default series type saved on the Settings page\)\. Allowed: standard, daily, anime\./,
    );
    assert.deepEqual(posts(), []);
    // A preview that fails stores nothing: the earlier one is still the current one.
    assert.deepEqual(previews(), current);
  });

  it("C10: the monitor option is the one named, else the setting, else all; a saved value outside the allowed ones is an error", async () => {
    // Every option offered is one Sonarr's published API schema lists (MonitorTypes).
    const sonarrMonitorTypes = [
      "unknown",
      "all",
      "future",
      "missing",
      "existing",
      "firstSeason",
      "lastSeason",
      "latestSeason",
      "pilot",
      "recent",
      "monitorSpecials",
      "unmonitorSpecials",
      "none",
      "skip",
    ];
    assert.deepEqual(
      [...MONITOR_OPTIONS],
      ["all", "future", "missing", "existing", "firstSeason", "lastSeason", "pilot", "none"],
    );
    for (const option of MONITOR_OPTIONS) assert.ok(sonarrMonitorTypes.includes(option), option);

    assert.match(text(await previewOf("quiet valley", [1])), /Monitor: all episodes \(`all`\)\n/);
    setSetting("SONARR_DEFAULT_MONITOR", "firstseason");
    assert.match(
      text(await confirmSelectedSeries({ chosenIndexes: [1] })),
      /Monitor: the first season \(`firstSeason`\)\n/,
    );
    assert.match(
      text(await confirmSelectedSeries({ chosenIndexes: [1], monitor: "pilot" })),
      /Monitor: the pilot episode \(`pilot`\)\n/,
    );

    setSetting("SONARR_DEFAULT_MONITOR", "latestSeason");
    const current = previews();
    const bad = await confirmSelectedSeries({ chosenIndexes: [1] });
    assert.equal(bad.isError, true);
    assert.match(
      text(bad),
      /"latestSeason" is not a monitor option \(that is the default monitor option saved on the Settings page\)\. Allowed: all, future, missing, existing, firstSeason, lastSeason, pilot, none\./,
    );
    assert.deepEqual(posts(), []);
    assert.deepEqual(previews(), current);
  });

  it("C11: searchForMissing defaults to true, and can be turned off", async () => {
    const on = await previewOf("quiet valley", [1]);
    assert.match(
      text(on),
      /Search: a search for the monitored episodes starts as soon as each show is added/,
    );
    await confirmSelectedSeries({ previewId: idOf(on) });
    assert.equal((posts()[0]!.body as any).addOptions.searchForMissingEpisodes, true);

    const off = await previewOf("quiet valley", [2], { searchForMissing: false });
    assert.match(text(off), /Search: no search is started/);
    await confirmSelectedSeries({ previewId: idOf(off) });
    assert.equal((posts()[1]!.body as any).addOptions.searchForMissingEpisodes, false);
  });

  it("C12: a preview sends only GET requests, no POST", async () => {
    await previewOf("harbour", [1, 3, 5], { monitor: "future", qualityProfile: "Anime" });
    assert.ok(sonarr.calls.length > 4);
    assert.deepEqual(nonGets(), []);
    assert.deepEqual(inSonarr, []);
  });

  it("C12: it says exactly what confirming would do: each show with its decision, and every setting", async () => {
    inSonarr = [{ id: 1, title: "Harbour Nights", tvdbId: 503, seasons: [{ seasonNumber: 1 }] }];
    setSetting("SONARR_DEFAULT_QUALITY_PROFILE", "WEB-2160p");
    const result = await previewOf("harbour", [3, 1], { seriesType: "daily", monitor: "missing" });
    assert.equal(result.isError, undefined);
    const body = text(result);
    assert.match(body, /nothing has been added yet/);
    assert.match(
      body,
      /- \*\*Harbour Nights \(2008\)\*\* \[TVDB: 503\], 1 season: already in Sonarr, will not be added/,
    );
    assert.match(body, /- \*\*Harbour Lights \(2019\)\*\* \[TVDB: 501\], 2 seasons: will be added/);
    assert.match(body, /Quality profile: WEB-2160p\n/);
    assert.match(body, /Root folder: \/media\/tvshows\n/);
    assert.match(body, /Series type: daily\n/);
    assert.match(body, /Monitor: missing episodes \(`missing`\)\n/);
    assert.match(body, /Search: a search for the monitored episodes starts/);
    assert.match(body, /Confirming adds 1 show as monitored/);
    assert.match(body, /call confirm_selected_series again with only previewId "/);
  });

  it("C12: it stores the preview: its id, the arguments as given, each show's TVDB id and title with its decision, Sonarr's URL and every resolved value", async () => {
    inSonarr = [{ id: 1, title: "Harbour Nights", tvdbId: 503 }];
    const result = await previewOf("harbour", [1, 3], {
      monitor: "pilot",
      searchForMissing: false,
    });
    const stored = previews();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.id, idOf(result));
    assert.deepEqual(JSON.parse(stored[0]!.payload), {
      given: { monitor: "pilot", searchForMissing: false, chosenIndexes: [1, 3] },
      sonarrUrl: "http://sonarr:8989",
      resolved: {
        qualityProfileId: 4,
        qualityProfile: "WEB-1080p",
        profileIsFirst: true,
        rootFolder: "/media/tvshows",
        seriesType: "standard",
        monitor: "pilot",
        searchForMissing: false,
      },
      // By TVDB id and title, not by grid number.
      // A show to add carries its seasons as they would be posted.
      shows: [
        {
          tvdbId: 501,
          title: "Harbour Lights",
          year: "2019",
          decision: "add",
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
        },
        { tvdbId: 503, title: "Harbour Nights", year: "2008", decision: "exists", seasons: null },
      ],
    });
  });

  it("C12: every preview has a new random id, and there is one current preview: a new one replaces it", async () => {
    const first = await previewOf("quiet valley", [1]);
    const second = await confirmSelectedSeries({ chosenIndexes: [1] });
    assert.notEqual(idOf(first), idOf(second));
    assert.match(
      idOf(first),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.deepEqual(
      previews().map((p) => p.id),
      [idOf(second)],
    );
  });

  it("C12: a new search_and_select_series clears the current preview", async () => {
    const preview = await previewOf("quiet valley", [1]);
    await search("harbour");
    assert.deepEqual(previews(), []);
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.equal(result.isError, true);
    assert.deepEqual(posts(), []);
  });

  it("C12: a preview of shows that are all in Sonarr already says nothing would be added", async () => {
    inSonarr = [{ id: 1, title: "Quiet Valley", tvdbId: 601 }];
    const preview = await previewOf("quiet valley", [1]);
    assert.match(text(preview), /Nothing would be added: every chosen show is already in Sonarr/);
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.match(text(result), /already in Sonarr; not added/);
    assert.deepEqual(posts(), []);
  });
});

describe("confirm_selected_series: the confirmation", () => {
  it("C13: previewId together with any other argument, or neither form, is an error and changes nothing", async () => {
    const preview = await previewOf("quiet valley", [1]);
    const id = idOf(preview);
    const before = sonarr.calls.length;
    for (const args of [
      { previewId: id, chosenIndexes: [1] },
      { previewId: id, qualityProfile: "Anime" },
      { previewId: id, rootFolder: "/media/tvshows" },
      { previewId: id, seriesType: "anime" },
      { previewId: id, monitor: "none" },
      { previewId: id, searchForMissing: false },
      {},
      { monitor: "none" },
    ]) {
      const result = await confirmSelectedSeries(args);
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.match(text(result), /Nothing was added/);
    }
    // Nothing was sent to Sonarr, and the preview is still the current one.
    assert.equal(sonarr.calls.length, before);
    assert.deepEqual(
      previews().map((p) => p.id),
      [id],
    );
    await confirmSelectedSeries({ previewId: id });
    assert.deepEqual(added(), ["Quiet Valley"]);
  });

  it("C13: an unknown id is an error that says to preview again, and nothing is sent to Sonarr", async () => {
    const preview = await previewOf("quiet valley", [1]);
    const before = sonarr.calls.length;
    const result = await confirmSelectedSeries({
      previewId: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /not the current preview/);
    assert.match(text(result), /for a new preview/);
    assert.equal(sonarr.calls.length, before);
    // The real preview was not used up by the wrong id.
    assert.deepEqual(
      previews().map((p) => p.id),
      [idOf(preview)],
    );
  });

  it("C13: an id that a later preview replaced sends nothing to Sonarr", async () => {
    const first = await previewOf("quiet valley", [1]);
    const second = await confirmSelectedSeries({ chosenIndexes: [2] });
    const before = sonarr.calls.length;
    const stale = await confirmSelectedSeries({ previewId: idOf(first) });
    assert.equal(stale.isError, true);
    assert.equal(sonarr.calls.length, before);
    // The newer preview is untouched and adds its own show.
    await confirmSelectedSeries({ previewId: idOf(second) });
    assert.deepEqual(added(), ["Quiet Valley Stories"]);
  });

  it("C13: after another search and preview with the same numbers and defaults, the first id is useless and the second adds the second preview's shows", async () => {
    const first = await previewOf("quiet valley", [1, 2]);
    const second = await previewOf("harbour", [1, 2]);
    const before = sonarr.calls.length;
    const stale = await confirmSelectedSeries({ previewId: idOf(first) });
    assert.equal(stale.isError, true);
    assert.equal(sonarr.calls.length, before);
    assert.deepEqual(posts(), []);

    const result = await confirmSelectedSeries({ previewId: idOf(second) });
    assert.equal(result.isError, undefined);
    assert.deepEqual(added(), ["Harbour Lights", "Harbour Lights: Origins"]);
    assert.deepEqual(
      posts().map((c) => (c.body as any).tvdbId),
      [501, 502],
    );
  });

  it("C13: the preview is taken and removed in one step, so an id that already added adds nothing a second time", async () => {
    const preview = await previewOf("quiet valley", [1]);
    const id = idOf(preview);
    await confirmSelectedSeries({ previewId: id });
    assert.deepEqual(added(), ["Quiet Valley"]);
    assert.deepEqual(previews(), []);

    const before = sonarr.calls.length;
    const again = await confirmSelectedSeries({ previewId: id });
    assert.equal(again.isError, true);
    assert.match(text(again), /already used/);
    assert.equal(sonarr.calls.length, before);
    assert.equal(posts().length, 1);
  });

  it("C13: a preview can be confirmed for 15 minutes, and says so; after that its id adds nothing, sends nothing and is removed", async () => {
    const LIFE = 15 * 60 * 1000;
    const start = Date.parse("2026-11-15T12:00:00Z");
    await search("quiet valley");
    const fresh = await confirmSelectedSeries({ chosenIndexes: [1] }, start);
    assert.match(text(fresh), /good for 15 minutes/);
    const justBefore = await confirmSelectedSeries({ previewId: idOf(fresh) }, start + LIFE - 1);
    assert.equal(justBefore.isError, undefined);
    assert.deepEqual(added(), ["Quiet Valley"]);

    const old = await confirmSelectedSeries({ chosenIndexes: [2] }, start);
    const before = sonarr.calls.length;
    const justAfter = await confirmSelectedSeries({ previewId: idOf(old) }, start + LIFE + 1);
    assert.equal(justAfter.isError, true);
    assert.match(
      text(justAfter),
      /That preview has expired: a preview can be confirmed for 15 minutes/,
    );
    assert.match(text(justAfter), /Nothing was added/);
    assert.match(text(justAfter), /Call confirm_selected_series with chosenIndexes/);
    assert.equal(sonarr.calls.length, before, "nothing is sent to Sonarr");
    assert.deepEqual(previews(), [], "the expired preview is removed");
    assert.deepEqual(added(), ["Quiet Valley"]);
  });

  it("C13: a setting changed after the preview adds nothing and returns a new preview that says what differs", async () => {
    const preview = await previewOf("quiet valley", [1]);
    setSetting("SONARR_DEFAULT_QUALITY_PROFILE", "WEB-2160p");
    setSetting("SONARR_DEFAULT_MONITOR", "pilot");
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.equal(result.isError, undefined);
    assert.deepEqual(posts(), []);
    assert.match(text(result), /Nothing was added: what the preview showed has changed/);
    assert.match(
      text(result),
      /the quality profile is now WEB-2160p \(the preview showed WEB-1080p\)/,
    );
    assert.match(text(result), /the monitor option is now pilot \(the preview showed all\)/);
    assert.match(text(result), /Quality profile: WEB-2160p\n/);
    const newId = idOf(result);
    assert.notEqual(newId, idOf(preview));

    // The old id is used up; the new preview's id adds with what it showed.
    assert.equal((await confirmSelectedSeries({ previewId: idOf(preview) })).isError, true);
    assert.deepEqual(posts(), []);
    await confirmSelectedSeries({ previewId: newId });
    assert.equal((posts()[0]!.body as any).qualityProfileId, 6);
    assert.equal((posts()[0]!.body as any).addOptions.monitor, "pilot");
  });

  it("C13: each resolved value is compared: folder, series type, search or not, a profile renamed in Sonarr", async () => {
    const changes: Array<[() => void, RegExp]> = [
      [
        () => setSetting("SONARR_DEFAULT_ROOT_FOLDER", "/media/tvshowskids"),
        /the root folder is now/,
      ],
      [() => setSetting("SONARR_DEFAULT_SERIES_TYPE", "anime"), /the series type is now anime/],
      [
        () => {
          profiles = [{ id: 4, name: "WEB-1080p v2" }, ...PROFILES.slice(1)];
        },
        /the quality profile is now WEB-1080p v2/,
      ],
      [
        () => {
          profiles = [{ id: 40, name: "WEB-1080p" }];
        },
        /the quality profile is now WEB-1080p \(the preview showed WEB-1080p\)/,
      ],
      [
        () => {
          roots = [{ path: "/media/other" }, ...ROOTS];
        },
        /the root folder is now \/media\/other/,
      ],
    ];
    for (const [change, says] of changes) {
      await resetDb();
      setSetting("SONARR_URL", "http://sonarr:8989");
      profiles = [...PROFILES];
      roots = [...ROOTS];
      const preview = await previewOf("quiet valley", [1]);
      change();
      const result = await confirmSelectedSeries({ previewId: idOf(preview) });
      assert.match(text(result), says);
      assert.match(text(result), /Nothing was added/);
      assert.deepEqual(posts(), []);
    }
  });

  it("C13: a changed Sonarr URL adds nothing", async () => {
    const preview = await previewOf("quiet valley", [1]);
    setSetting("SONARR_URL", "http://new:8989");
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.match(text(result), /Nothing was added/);
    assert.match(text(result), /the Sonarr URL has changed/);
    assert.deepEqual(posts(), []);
    assert.equal(JSON.parse(previews()[0]!.payload).sonarrUrl, "http://new:8989");
  });

  it("C13: a show to add that Sonarr has meanwhile adds nothing and returns a new preview", async () => {
    const preview = await previewOf("quiet valley", [1, 2]);
    inSonarr = [{ id: 9, title: "Quiet Valley", tvdbId: 601 }];
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.deepEqual(posts(), [], "not even the show whose decision did not change is added");
    assert.match(
      text(result),
      /Quiet Valley is now already in Sonarr \(the preview showed it would be added\)/,
    );
    assert.match(text(result), /\[TVDB: 601\], .*: already in Sonarr, will not be added/);
    assert.match(text(result), /\[TVDB: 602\], .*: will be added/);
    await confirmSelectedSeries({ previewId: idOf(result) });
    assert.deepEqual(added(), ["Quiet Valley Stories"]);
  });

  it("C13: a show shown as already there that Sonarr no longer has adds nothing and returns a new preview", async () => {
    inSonarr = [{ id: 9, title: "Quiet Valley", tvdbId: 601 }];
    const preview = await previewOf("quiet valley", [1, 2]);
    assert.match(text(preview), /\[TVDB: 601\], .*: already in Sonarr/);
    inSonarr = [];
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.deepEqual(posts(), []);
    assert.match(
      text(result),
      /Quiet Valley is no longer in Sonarr \(the preview showed it as already there\)/,
    );
    assert.notEqual(idOf(result), idOf(preview));
  });

  it("C13: a season added to the show between preview and confirmation adds nothing and returns a new preview", async (t) => {
    const original = CATALOG[6]!;
    t.after(() => {
      CATALOG[6] = original;
    });
    const preview = await previewOf("quiet valley", [1]);
    assert.match(text(preview), /\[TVDB: 601\], 2 seasons: will be added/);
    CATALOG[6] = lookupSeries(601, "Quiet Valley", 2020, {
      seasons: [...original.seasons, { seasonNumber: 3, monitored: true }],
    });
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.deepEqual(posts(), []);
    assert.match(text(result), /Nothing was added: what the preview showed has changed/);
    assert.match(text(result), /Quiet Valley now has 3 seasons \(the preview showed 2\)/);
    assert.match(text(result), /\[TVDB: 601\], 3 seasons: will be added/);

    // The new preview adds the seasons it showed.
    await confirmSelectedSeries({ previewId: idOf(result) });
    assert.deepEqual(
      (posts()[0]!.body as any).seasons.map((s: any) => s.seasonNumber),
      [0, 1, 2, 3],
    );
  });

  it("C13: a season's monitored flag changed between preview and confirmation adds nothing and returns a new preview", async (t) => {
    const original = CATALOG[6]!;
    t.after(() => {
      CATALOG[6] = original;
    });
    const preview = await previewOf("quiet valley", [1]);
    CATALOG[6] = lookupSeries(601, "Quiet Valley", 2020, {
      seasons: [
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: false },
        { seasonNumber: 2, monitored: true },
      ],
    });
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.deepEqual(posts(), []);
    assert.match(
      text(result),
      /season 1 of Quiet Valley is now not monitored in Sonarr's lookup \(the preview showed it monitored\)/,
    );
    assert.notEqual(idOf(result), idOf(preview));
  });

  it("C13: when what the preview showed can no longer be resolved, nothing is added", async () => {
    const preview = await previewOf("quiet valley", [1], { qualityProfile: "Anime" });
    profiles = PROFILES.slice(0, 2);
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.equal(result.isError, true);
    assert.match(
      text(result),
      /Nothing was added: what the preview showed can no longer be resolved/,
    );
    assert.match(text(result), /No Sonarr quality profile named "Anime"/);
    assert.deepEqual(posts(), []);
    assert.deepEqual(previews(), []);
  });

  it("C14: on a match, a fixed list of fields from Sonarr's lookup record is posted with the resolved settings, nothing else", async (t) => {
    const original = CATALOG[2]!;
    // A lookup record carrying fields that must not go back to Sonarr.
    CATALOG[2] = lookupSeries(503, "Harbour Nights", 2008, {
      status: "ended",
      network: "Network Two",
      path: "/somewhere/else/Harbour Nights",
      id: 77,
      tags: [3, 4],
      languageProfileId: 1,
      qualityProfileId: 99,
      rootFolderPath: "/elsewhere",
      monitored: false,
      added: "2020-01-01T00:00:00Z",
      statistics: { seasonCount: 2 },
      seasons: [
        { seasonNumber: 0, monitored: false, statistics: { episodeCount: 3 } },
        { seasonNumber: 1, monitored: true, images: [] },
        { seasonNumber: 2, monitored: false },
      ],
    });
    t.after(() => {
      CATALOG[2] = original;
    });
    const preview = await previewOf("harbour", [3], {
      qualityProfile: "WEB-2160p",
      rootFolder: "/media/tvshowskids",
      seriesType: "anime",
      monitor: "firstSeason",
    });
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.equal(result.isError, undefined);
    assert.equal(posts().length, 1);
    assert.equal(posts()[0]!.url, "/api/v3/series");
    assert.deepEqual(posts()[0]!.body, {
      tvdbId: 503,
      title: "Harbour Nights",
      titleSlug: "harbour-nights",
      year: 2008,
      images: [{ coverType: "poster", remoteUrl: "https://artworks.example.org/posters/503.jpg" }],
      seasons: [
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: false },
      ],
      qualityProfileId: 6,
      rootFolderPath: "/media/tvshowskids/",
      monitored: true,
      seasonFolder: true,
      seriesType: "anime",
      addOptions: {
        monitor: "firstSeason",
        searchForMissingEpisodes: true,
        searchForCutoffUnmetEpisodes: false,
      },
    });
    const [opening, line] = text(result).split("\n");
    assert.equal(
      opening,
      "🚀 **Adding series to Sonarr** (profile: WEB-2160p, folder: /media/tvshowskids/, type: anime, monitor: firstSeason, search for monitored episodes started)",
    );
    assert.match(
      line!,
      /✅ \*\*Harbour Nights \(2008\)\*\* \[TVDB: 503\] - added; search for its monitored episodes started\./,
    );
  });

  it("C14: shows marked as already there are reported and not posted; one show failing doesn't stop the others; validation messages are shown", async () => {
    inSonarr = [{ id: 1, title: "Harbour Lights", tvdbId: 501 }];
    addErrors[502] = {
      status: 400,
      data: [
        { propertyName: "Path", errorMessage: "Path is already configured for another series" },
        { propertyName: "TitleSlug", errorMessage: "Title slug is in use by another series" },
      ],
    };
    const preview = await previewOf("harbour", [1, 2, 3]);
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.deepEqual(added(), ["Harbour Lights: Origins", "Harbour Nights"]);
    const reportLines = text(result).split("\n").slice(1).filter(Boolean);
    assert.equal(reportLines.length, 3, "one line per show");
    assert.match(reportLines[0]!, /⏭️ .*Harbour Lights \(2019\).* - already in Sonarr; not added\./);
    assert.match(
      reportLines[1]!,
      /❌ .*Harbour Lights: Origins.* - failed: Path is already configured for another series; Title slug is in use by another series/,
    );
    assert.match(reportLines[2]!, /✅ .*Harbour Nights.* - added/);
    assert.deepEqual(
      inSonarr.map((s) => s.tvdbId),
      [501, 503],
    );
  });

  it("C14: Sonarr unreachable at confirmation is an error reply, and nothing is added", async () => {
    const preview = await previewOf("quiet valley", [1]);
    sonarrDown = true;
    const result = await confirmSelectedSeries({ previewId: idOf(preview) });
    assert.equal(result.isError, true);
    assert.match(
      text(result),
      /Sonarr could not be read, so nothing was added: connect ECONNREFUSED/,
    );
    // The id was used up by the attempt, and the reply says to preview again.
    assert.match(
      text(result),
      /That preview is used up\. Call confirm_selected_series with chosenIndexes/,
    );
    assert.deepEqual(previews(), []);
    assert.deepEqual(posts(), []);
  });

  it("C15: no reply or error contains the API key, even when Sonarr's own messages do", async () => {
    const replies: string[] = [];
    const keep = (r: { content: Array<{ text: string }> }) => {
      replies.push(text(r));
      return r;
    };
    const original = CATALOG[6]!;
    CATALOG[6] = lookupSeries(601, "Quiet Valley", 2020, {
      overview: `A plot that quotes apikey=${API_KEY} for some reason.`,
    });
    try {
      addErrors[602] = {
        status: 400,
        data: [{ errorMessage: `Request to http://sonarr:8989/?apikey=${API_KEY} failed` }],
      };
      keep(await search("quiet valley"));
      const preview = keep(await confirmSelectedSeries({ chosenIndexes: [1, 2] }));
      keep(await confirmSelectedSeries({ previewId: idOf(preview), monitor: "all" }));
      keep(await confirmSelectedSeries({ previewId: idOf(preview) }));
      keep(await confirmSelectedSeries({ previewId: idOf(preview) }));
      keep(await confirmSelectedSeries({ chosenIndexes: [1], qualityProfile: API_KEY }));
      keep(await confirmSelectedSeries({ chosenIndexes: [1], rootFolder: `/x/${API_KEY}` }));
      sonarr.restore();
      sonarr = fakeApi(sonarrClient, () => ({
        status: 401,
        data: { message: `Unauthorized: ${API_KEY}` },
      }));
      keep(await search("quiet valley"));
      keep(await confirmSelectedSeries({ chosenIndexes: [1] }));
    } finally {
      CATALOG[6] = original;
    }
    assert.equal(replies.length, 9);
    assert.ok(
      replies.some((r) => r.includes("[redacted]")),
      "the key was in play and was removed",
    );
    for (const r of replies) assert.ok(!r.includes(API_KEY), r);
    // Stored previews hold no key either.
    for (const p of previews()) assert.ok(!p.payload.includes(API_KEY));
  });
});

describe("adding series: settings, registration and independence from the movie flow", () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  before(async () => {
    app = await startApp();
    // As src/index.ts does at start: each set of tools is registered once.
    registerDiscoveryTools();
    registerSeriesAddTools();
  });
  after(() => app.close());
  const getSettings = async () =>
    (await (await fetch(`${app.base}/api/settings`)).json()) as Record<
      string,
      Record<string, unknown>
    >;
  const putSonarr = (body: unknown) =>
    fetch(`${app.base}/api/settings/sonarr`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("C16: the four settings round-trip through the settings API, trimmed, and an empty value clears them", async () => {
    delete process.env.WEB_PASSWORD;
    const res = await putSonarr({
      defaultQualityProfile: "  WEB-2160p ",
      defaultRootFolder: " /media/tvshowskids ",
      defaultSeriesType: " anime",
      defaultMonitor: "firstSeason  ",
    });
    assert.equal(res.status, 200);
    assert.equal(getSetting("SONARR_DEFAULT_QUALITY_PROFILE"), "WEB-2160p");
    assert.equal(getSetting("SONARR_DEFAULT_ROOT_FOLDER"), "/media/tvshowskids");
    assert.equal(getSetting("SONARR_DEFAULT_SERIES_TYPE"), "anime");
    assert.equal(getSetting("SONARR_DEFAULT_MONITOR"), "firstSeason");
    // Plain fields, not secrets: the browser gets the values back.
    const { sonarr: saved } = await getSettings();
    assert.deepEqual(
      [
        saved!.defaultQualityProfile,
        saved!.defaultRootFolder,
        saved!.defaultSeriesType,
        saved!.defaultMonitor,
      ],
      ["WEB-2160p", "/media/tvshowskids", "anime", "firstSeason"],
    );
    for (const key of [
      "SONARR_DEFAULT_QUALITY_PROFILE",
      "SONARR_DEFAULT_ROOT_FOLDER",
      "SONARR_DEFAULT_SERIES_TYPE",
      "SONARR_DEFAULT_MONITOR",
    ] as const)
      assert.ok(!SECRET_SETTINGS_KEYS.has(key), `${key} is not a secret`);
    // The API key was left alone, and is still never returned.
    assert.equal(getSetting("SONARR_API_KEY"), API_KEY);
    assert.deepEqual(saved!.apiKey, { configured: true });

    await putSonarr({
      defaultQualityProfile: "",
      defaultRootFolder: " ",
      defaultSeriesType: "",
      defaultMonitor: "",
    });
    const { sonarr: cleared } = await getSettings();
    assert.deepEqual(
      [
        cleared!.defaultQualityProfile,
        cleared!.defaultRootFolder,
        cleared!.defaultSeriesType,
        cleared!.defaultMonitor,
      ],
      ["", "", "", ""],
    );
    // The saved values are what the next preview uses.
    await putSonarr({ defaultMonitor: "none", defaultSeriesType: "daily" });
    const preview = await previewOf("quiet valley", [1]);
    assert.match(text(preview), /Series type: daily\n- Monitor: no episodes \(`none`\)/);
  });

  it("C16: the Settings page's Sonarr tab, the dashboard's API type, the OpenAPI document and .env.example carry the four settings", () => {
    const page = fs.readFileSync(path.join(repo, "web/src/pages/SettingsPage.tsx"), "utf8");
    const sonarrTab = page.slice(page.indexOf('value: "sonarr"'), page.indexOf('value: "radarr"'));
    const fields = [
      "defaultQualityProfile",
      "defaultRootFolder",
      "defaultSeriesType",
      "defaultMonitor",
    ];
    for (const field of fields) {
      assert.ok(sonarrTab.includes(`name: "${field}"`), `${field} is a field of the Sonarr tab`);
    }
    // Text fields: none of the four is marked secret (a password input).
    assert.equal((sonarrTab.match(/secret: true/g) ?? []).length, 1, "only the API key is secret");

    const apiTypes = fs.readFileSync(path.join(repo, "web/src/api.ts"), "utf8");
    const openapi = JSON.parse(fs.readFileSync(path.join(repo, "docs/api/openapi.json"), "utf8"));
    const schemas = openapi.components.schemas;
    const sonarrSchema = Object.values(schemas).find(
      (s: any) => s?.properties?.sonarr?.properties?.apiKey,
    ) as any;
    for (const field of fields) {
      assert.ok(apiTypes.includes(`${field}: string;`), `${field} in web/src/api.ts`);
      assert.deepEqual(sonarrSchema.properties.sonarr.properties[field], { type: "string" });
      assert.ok(
        schemas.ServiceSettingsUpdate.properties[field],
        `${field} in ServiceSettingsUpdate`,
      );
    }
    const envExample = fs.readFileSync(path.join(repo, ".env.example"), "utf8");
    for (const key of [
      "SONARR_DEFAULT_QUALITY_PROFILE=",
      "SONARR_DEFAULT_ROOT_FOLDER=",
      "SONARR_DEFAULT_SERIES_TYPE=",
      "SONARR_DEFAULT_MONITOR=",
    ])
      assert.ok(envExample.split("\n").includes(key), `${key} in .env.example, empty`);
  });

  it("C17: a movie search or confirmation leaves the series grid and preview as they are, and a series search leaves the movie grid", async () => {
    const tools = (server as any)._registeredTools;
    const movieSearch =
      tools.search_and_select_movies.handler ?? tools.search_and_select_movies.callback;
    const tmdb = fakeApi(tmdbClient, () => ({
      data: { results: [{ id: 603, title: "A Movie", release_date: "1999-03-31" }] },
    }));
    const radarr = fakeApi(radarrClient, (req: RecordedRequest) => {
      if (req.url === "/api/v3/qualityprofile") return { data: [{ id: 1, name: "Any" }] };
      if (req.url === "/api/v3/rootfolder") return { data: [{ path: "/media/movies" }] };
      if (req.method === "get" && req.url === "/api/v3/movie") return { data: [] };
      if (req.url === "/api/v3/movie/lookup/tmdb")
        return { data: { title: "A Movie", tmdbId: 603 } };
      if (req.method === "post") return { status: 201, data: {} };
      return { status: 404 };
    });
    setSetting("RADARR_URL", "http://radarr:7878");
    const movieGrid = () => db.prepare("SELECT tmdb_id FROM interaction_context").all();
    try {
      const preview = await previewOf("quiet valley", [1]);
      const seriesGridBefore = grid();
      const previewBefore = previews();

      // A movie search, then a movie confirmation.
      await movieSearch({ query: "a movie" }, {});
      assert.deepEqual(movieGrid(), [{ tmdb_id: 603 }]);
      await confirmSelectedChoices({ chosenIndexes: [1] });
      assert.deepEqual(grid(), seriesGridBefore);
      assert.deepEqual(previews(), previewBefore);

      // A series search replaces the series grid and leaves the movie grid.
      await search("harbour");
      assert.equal(grid().length, 5);
      assert.deepEqual(movieGrid(), [{ tmdb_id: 603 }]);

      // The series preview made before the movie calls was still good until that new search.
      assert.equal((await confirmSelectedSeries({ previewId: idOf(preview) })).isError, true);
      assert.deepEqual(posts(), []);
    } finally {
      tmdb.restore();
      radarr.restore();
    }
  });

  it("C17: resetDb empties both new tables", async () => {
    await previewOf("quiet valley", [1]);
    assert.equal(grid().length, 2);
    assert.equal(previews().length, 1);
    await resetDb();
    assert.deepEqual(grid(), []);
    assert.deepEqual(previews(), []);
  });

  it("C5, C12: both tools are registered for MCP clients only: the Query chat's tool list does not have them", () => {
    const registered = Object.keys((server as any)._registeredTools);
    const names = ["search_and_select_series", "confirm_selected_series"];
    for (const name of names) {
      assert.ok(registered.includes(name), `${name} is registered with the MCP server`);
      assert.ok(
        !movieTools.some((t) => t.name === name),
        `${name} is not in the chat's definitions`,
      );
      assert.ok(!SYSTEM_PROMPT.includes(name), `${name} is not in the chat's prompt`);
    }
    // The guidance for MCP clients routes to both and names the confirm tool as one that changes something.
    assert.ok(ROUTES.some((r) => names.every((n) => r.tools.includes(n))));
    assert.match(CHANGE_RULES[0]!, /Tools that change something \([^)]*confirm_selected_series/);
    assert.ok(
      CHANGE_RULES.some((r) => /search, preview, then confirm/.test(r) && /previewId/.test(r)),
    );
  });

  it("C13: the tool's schema takes a previewId or chosenIndexes with options, and only the listed series types and monitor options", async () => {
    const tool = (server as any)._registeredTools.confirm_selected_series;
    const schema = tool.inputSchema;
    const parse = (input: unknown) => schema.safeParse(input).success;
    assert.equal(parse({ previewId: "abc" }), true);
    assert.equal(
      parse({ chosenIndexes: [1, 2], seriesType: "daily", monitor: "lastSeason" }),
      true,
    );
    assert.equal(parse({ chosenIndexes: [1], seriesType: "miniseries" }), false);
    assert.equal(parse({ chosenIndexes: [1], monitor: "latestSeason" }), false);
    assert.equal(parse({ chosenIndexes: ["1"] }), false);
    // Called past the schema, a value outside the lists is still refused.
    await search("quiet valley");
    const result = await confirmSelectedSeries({ chosenIndexes: [1], monitor: "recent" });
    assert.equal(result.isError, true);
    assert.match(text(result), /"recent" is not a monitor option\. Allowed:/);
  });
});
