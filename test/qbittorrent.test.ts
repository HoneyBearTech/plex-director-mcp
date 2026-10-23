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
  // qBittorrent 4.x to 5.1: 200 with "Ok.".
  it("posts form-encoded credentials and returns only the SID cookie pair", async () => {
    fake = fakeApi(qbitClient, () => ({
      data: "Ok.",
      headers: { "set-cookie": ["other=1", "SID=abc123; HttpOnly; path=/"] },
    }));
    const session = await loginToQbittorrent();
    assert.deepEqual(session, { headers: { Cookie: "SID=abc123" } });
    const call = fake.calls[0]!;
    assert.equal(call.url, "/api/v2/auth/login");
    assert.equal(
      call.body,
      "username=admin&password=p%26ss%20word%3D1",
      "credentials are URL-encoded",
    );
    assert.equal(call.headers["Content-Type"], "application/x-www-form-urlencoded");
  });

  // qBittorrent 4.x to 5.1 answer 200 either way; "Fails." means bad credentials.
  it("throws a clear error on bad credentials instead of carrying on with no session", async () => {
    fake = fakeApi(qbitClient, () => ({ data: "Fails." }));
    await assert.rejects(
      loginToQbittorrent(),
      /qBittorrent login failed - check the qBittorrent username and password/,
    );
  });

  // qBittorrent 5.2 and later: 204 with no body, cookie named after the port.
  it("accepts 5.x's 204 with an empty body and keeps its QBT_SID_<port> cookie", async () => {
    fake = fakeApi(qbitClient, () => ({
      status: 204,
      data: "",
      headers: { "set-cookie": ["QBT_SID_8080=xyz; HttpOnly; SameSite=Lax; path=/"] },
    }));
    assert.deepEqual(await loginToQbittorrent(), { headers: { Cookie: "QBT_SID_8080=xyz" } });
  });

  it("treats 5.x's 401 as bad credentials", async () => {
    fake = fakeApi(qbitClient, () => ({ status: 401, data: "Unauthorized" }));
    await assert.rejects(
      loginToQbittorrent(),
      /qBittorrent login failed - check the qBittorrent username and password/,
    );
  });

  it("says the IP is banned on 403, not that the password is wrong", async () => {
    fake = fakeApi(qbitClient, () => ({
      status: 403,
      data: "Your IP address has been banned after too many failed authentication attempts.",
    }));
    await assert.rejects(loginToQbittorrent(), (error: Error) => {
      assert.match(error.message, /banned this server's IP address after too many failed logins/);
      return true;
    });
  });

  // A client in qBittorrent's auth bypass (localhost or a whitelisted subnet)
  // may get no cookie back; the next requests must still go out, without one.
  it("works without a Set-Cookie and then sends no Cookie header", async () => {
    fake = fakeApi(qbitClient, (req) =>
      req.url === "/api/v2/auth/login" ? { status: 204, data: "" } : { data: [] },
    );
    const session = await loginToQbittorrent();
    assert.deepEqual(session, { headers: {} });
    await getDownloadingTorrents(session);
    assert.equal(fake.calls[1]!.headers.Cookie, undefined);
  });

  it("rejects a reply that isn't qBittorrent's, such as a web page", async () => {
    fake = fakeApi(qbitClient, () => ({ data: "<!doctype html><title>Sign in</title>" }));
    await assert.rejects(
      loginToQbittorrent(),
      /unexpected reply \(HTTP 200\); check that the qBittorrent URL/,
    );
  });

  it("propagates a server error unchanged", async () => {
    fake = fakeApi(qbitClient, () => ({ status: 500 }));
    await assert.rejects(loginToQbittorrent(), /status code 500/);
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

  it("deleteTorrent encodes the hash, so it can't add form fields", async () => {
    fake = fakeApi(qbitClient, () => ({ data: "" }));
    await deleteTorrent({ headers: { Cookie: "SID=abc" } }, "abc&deleteFiles=false|def");
    assert.equal(fake.calls[0]!.body, "hashes=abc%26deleteFiles%3Dfalse%7Cdef&deleteFiles=true");
  });
});
