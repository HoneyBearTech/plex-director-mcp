import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { qbitClient } from "../src/clients.js";
import { setSetting } from "../src/settings.js";
import { auditStalled, isStalled, purgeStalled } from "../src/stalledDownloads.js";
import type { QbitTorrent } from "../src/types/qbittorrent.js";
import { fakeApi } from "./helpers.js";

const torrent = (hash: string, name: string, over: Partial<QbitTorrent> = {}): QbitTorrent => ({
  hash,
  name,
  state: "downloading",
  progress: 0.5,
  dlspeed: 10 * 1024,
  size: 1e9,
  num_seeds: 1,
  ...over,
});
const STUCK = torrent("aaa111", "Stuck.Movie.2020", { state: "stalledDL", dlspeed: 0 });
const SLOW = torrent("bbb222", "Slow.Show.S01E01");
const FAST = torrent("ccc333", "Fast.Movie.2021", { dlspeed: 5000 * 1024 });

let fake: ReturnType<typeof fakeApi>;
let queue: QbitTorrent[];
const deletes = () =>
  fake.calls.filter((c) => c.url === "/api/v2/torrents/delete").map((c) => String(c.body));

beforeEach(() => {
  setSetting("QBITTORRENT_URL", "http://qbit.invalid");
  queue = [STUCK, SLOW, FAST];
  fake = fakeApi(qbitClient, (req) => {
    if (req.url === "/api/v2/auth/login")
      return { data: "Ok.", headers: { "set-cookie": ["SID=s; path=/"] } };
    if (req.url.startsWith("/api/v2/torrents/info")) return { data: queue };
    return { data: "" };
  });
});
afterEach(() => fake.restore());

describe("isStalled", () => {
  it("counts qBittorrent's stalled state and anything moving below the threshold", () => {
    assert.equal(isStalled(STUCK, 50), true);
    assert.equal(isStalled(SLOW, 50), true);
    assert.equal(isStalled(FAST, 50), false);
    assert.equal(
      isStalled(torrent("x", "queued", { dlspeed: 0 }), 50),
      false,
      "0 KB/s but not stalled",
    );
  });
});

describe("AUDIT", () => {
  it("lists stalled torrents with their hashes and deletes nothing", async () => {
    const { text, isError } = await auditStalled(50);
    assert.equal(isError, false);
    assert.match(text, /2 stalled/);
    assert.match(text, /Stuck\.Movie\.2020\*\* \(hash `aaa111`\)/);
    assert.match(text, /Slow\.Show\.S01E01\*\* \(hash `bbb222`\)/);
    assert.doesNotMatch(text, /Fast\.Movie/);
    assert.match(text, /Nothing was changed/);
    assert.deepEqual(deletes(), []);
  });
});

describe("PURGE_STALLED", () => {
  it("refuses without hashes, so it can never delete 'whatever is stalled'", async () => {
    for (const hashes of [[], ["", "  "]]) {
      const { text, isError } = await purgeStalled(hashes, 50);
      assert.equal(isError, true);
      assert.match(text, /needs the hashes.*Nothing was deleted/);
    }
    assert.deepEqual(deletes(), []);
    assert.equal(fake.calls.length, 0, "qBittorrent isn't even contacted");
  });

  it("deletes only the named torrents, and only while they are still stalled", async () => {
    const { text, isError } = await purgeStalled(["AAA111", "ccc333", "ddd444", "aaa111"], 50);
    assert.equal(isError, false);
    assert.deepEqual(deletes(), ["hashes=aaa111&deleteFiles=true"], "one delete, the stalled one");
    assert.match(text, /deleted 1 of 3/);
    assert.match(text, /Deleted from qBittorrent, with its files: \*\*Stuck\.Movie\.2020\*\*/);
    assert.match(text, /\*\*Fast\.Movie\.2021\*\*: downloading normally again/);
    assert.match(text, /`ddd444`: not downloading in qBittorrent any more/);
    assert.match(text, /nothing was blocklisted/);
    assert.doesNotMatch(text, /Slow\.Show/, "an unnamed stalled torrent is untouched");
  });

  it("says what was already deleted when a later delete fails", async () => {
    fake.restore();
    let n = 0;
    fake = fakeApi(qbitClient, (req) => {
      if (req.url === "/api/v2/auth/login") return { data: "Ok.", headers: {} };
      if (req.url.startsWith("/api/v2/torrents/info")) return { data: queue };
      return ++n === 2 ? { status: 500 } : { data: "" };
    });
    const { text, isError } = await purgeStalled(["aaa111", "bbb222"], 50);
    assert.equal(isError, true);
    assert.match(text, /Already deleted, with their files: Stuck\.Movie\.2020\./);
  });
});
