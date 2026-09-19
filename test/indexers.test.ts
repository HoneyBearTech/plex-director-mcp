import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { prowlarrClient } from "../src/clients.js";
import { getIndexerHealth } from "../src/indexers.js";
import { fakeApi } from "./helpers.js";

const hour = 3_600_000;
const inFuture = () => new Date(Date.now() + hour).toISOString();
const inPast = () => new Date(Date.now() - hour).toISOString();

let fake: ReturnType<typeof fakeApi> | undefined;
afterEach(() => fake?.restore());

function prowlarr(data: { indexers: any[]; statuses?: any[]; health?: any[] }) {
  fake = fakeApi(prowlarrClient, (req) => {
    if (req.url === "/api/v1/indexer") return { data: data.indexers };
    if (req.url === "/api/v1/indexerstatus") return { data: data.statuses ?? [] };
    if (req.url === "/api/v1/health") return { data: data.health ?? [] };
    return { status: 404 };
  });
}

const cfg = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, protocol: "usenet", priority: 1, enable: true, ...extra });

describe("getIndexerHealth", () => {
  it("reports everything healthy when Prowlarr lists no failures", async () => {
    prowlarr({ indexers: [cfg(1, "NZBgeek"), cfg(2, "Orpheus", { protocol: "torrent" })] });
    const { indexers, warnings } = await getIndexerHealth();
    assert.deepEqual(indexers.map((i) => [i.name, i.state]), [["NZBgeek", "healthy"], ["Orpheus", "healthy"]]);
    assert.deepEqual(warnings, []);
  });

  it("classifies backing-off, recent-failure, disabled and healthy indexers", async () => {
    prowlarr({
      indexers: [cfg(1, "Good"), cfg(2, "Banned"), cfg(3, "Flaky"), cfg(4, "Off", { enable: false })],
      statuses: [
        { indexerId: 2, disabledTill: inFuture(), mostRecentFailure: inPast(), escalationLevel: 3 },
        { indexerId: 3, disabledTill: inPast(), mostRecentFailure: inPast(), escalationLevel: 1 },
      ],
    });
    const { indexers } = await getIndexerHealth();
    const byName = Object.fromEntries(indexers.map((i) => [i.name, i]));
    assert.equal(byName.Good!.state, "healthy");
    assert.equal(byName.Banned!.state, "backing-off");
    assert.equal(byName.Banned!.escalationLevel, 3);
    assert.ok(byName.Banned!.disabledTill);
    assert.equal(byName.Flaky!.state, "warning");
    assert.equal(byName.Flaky!.disabledTill, null, "a backoff in the past is not reported as active");
    assert.equal(byName.Off!.state, "disabled");
  });

  it("sorts problems first: backing-off, warning, disabled, healthy (then by name)", async () => {
    prowlarr({
      indexers: [cfg(1, "Zed"), cfg(2, "Alpha"), cfg(3, "Off", { enable: false }), cfg(4, "Flaky"), cfg(5, "Banned")],
      statuses: [
        { indexerId: 5, disabledTill: inFuture(), escalationLevel: 2 },
        { indexerId: 4, disabledTill: inPast(), escalationLevel: 1 },
      ],
    });
    assert.deepEqual((await getIndexerHealth()).indexers.map((i) => i.name), ["Banned", "Flaky", "Off", "Alpha", "Zed"]);
  });

  it("a disabled indexer stays disabled even if it also has a failure record", async () => {
    prowlarr({ indexers: [cfg(1, "Off", { enable: false })], statuses: [{ indexerId: 1, disabledTill: inFuture() }] });
    assert.equal((await getIndexerHealth()).indexers[0]!.state, "disabled");
  });

  // Regression: the tool once read `lastFailure`, which Prowlarr doesn't have.
  it("reads the failure time from mostRecentFailure", async () => {
    const failedAt = inPast();
    prowlarr({ indexers: [cfg(1, "X")], statuses: [{ indexerId: 1, disabledTill: inFuture(), mostRecentFailure: failedAt, lastFailure: "wrong-field" }] });
    assert.equal((await getIndexerHealth()).indexers[0]!.mostRecentFailure, failedAt);
  });

  it("passes Prowlarr's own system warnings through", async () => {
    prowlarr({ indexers: [], health: [{ type: "warning", source: "AllowedHostsCheck", message: "Allowed Hosts is not configured" }] });
    assert.deepEqual((await getIndexerHealth()).warnings, [{ type: "warning", source: "AllowedHostsCheck", message: "Allowed Hosts is not configured" }]);
  });

  it("propagates a Prowlarr outage instead of reporting healthy", async () => {
    fake = fakeApi(prowlarrClient, () => ({ status: 503 }));
    await assert.rejects(getIndexerHealth());
  });
});
