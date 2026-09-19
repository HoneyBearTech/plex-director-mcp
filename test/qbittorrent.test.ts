import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { qbitClient } from "../src/clients.js";
import { deleteTorrent, getDownloadingTorrents, loginToQbittorrent } from "../src/qbittorrent.js";
import { setSetting } from "../src/settings.js";
import { fakeApi } from "./helpers.js";

let fake: ReturnType<typeof fakeApi>;
afterEach(() => fake?.restore());
beforeEach(() => {
  setSetting("QBITTORRENT_USER", "admin");
  setSetting("QBITTORRENT_PASS", "p&ss word=1");
});

describe("loginToQbittorrent", () => {
  it("posts form-encoded credentials and returns only the SID cookie pair", async () => {
    fake = fakeApi(qbitClient, () => ({ data: "Ok.", headers: { "set-cookie": ["SID=abc123; HttpOnly; path=/", "other=1"] } }));
    const session = await loginToQbittorrent();
    assert.deepEqual(session, { headers: { Cookie: "SID=abc123" } });
    const call = fake.calls[0]!;
    assert.equal(call.url, "/api/v2/auth/login");
    assert.equal(call.body, "username=admin&password=p%26ss%20word%3D1", "credentials are URL-encoded");
    assert.equal(call.headers["Content-Type"], "application/x-www-form-urlencoded");
  });

  // qBittorrent answers 200 either way; "Fails." means bad credentials.
  it("throws a clear error on bad credentials instead of carrying on with no session", async () => {
    fake = fakeApi(qbitClient, () => ({ data: "Fails." }));
    await assert.rejects(loginToQbittorrent(), /qBittorrent login failed - check the qBittorrent username and password/);
  });

  it("propagates a network failure", async () => {
    fake = fakeApi(qbitClient, () => {
      throw new Error("connect ECONNREFUSED");
    });
    await assert.rejects(loginToQbittorrent(), /ECONNREFUSED/);
  });
});

describe("torrent calls", () => {
  it("lists downloading torrents using the session cookie", async () => {
    fake = fakeApi(qbitClient, () => ({ data: [{ hash: "h1", name: "A" }] }));
    const torrents = await getDownloadingTorrents({ headers: { Cookie: "SID=abc" } });
    assert.deepEqual(torrents, [{ hash: "h1", name: "A" }]);
    assert.equal(fake.calls[0]!.url, "/api/v2/torrents/info?filter=downloading");
    assert.equal(fake.calls[0]!.headers.Cookie, "SID=abc");
  });

  it("deleteTorrent sends the exact request the purge action relies on", async () => {
    fake = fakeApi(qbitClient, () => ({ data: "" }));
    await deleteTorrent({ headers: { Cookie: "SID=abc" } }, "deadbeef");
    const call = fake.calls[0]!;
    assert.equal(call.method, "post");
    assert.equal(call.url, "/api/v2/torrents/delete");
    assert.equal(call.body, "hashes=deadbeef&deleteFiles=true");
    assert.equal(call.headers.Cookie, "SID=abc");
    assert.equal(call.headers["Content-Type"], "application/x-www-form-urlencoded");
  });
});
