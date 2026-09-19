import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { radarrClient } from "../src/clients.js";
import { db } from "../src/db.js";
import { stepJob } from "../src/jobs.js";
import { getRunnerIntervalSeconds, runJobRunnerTick } from "../src/jobRunner.js";
import { fakeApi, resetDb } from "./helpers.js";

// A fake Radarr that records which movies were searched. Nothing real is called.
let searched: number[];
let radarrDown: boolean;
let fake: ReturnType<typeof fakeApi>;

beforeEach(async () => {
  await resetDb();
  searched = [];
  radarrDown = false;
  fake = fakeApi(radarrClient, (req) => {
    if (radarrDown) throw new Error("connect ECONNREFUSED (simulated)");
    assert.equal(req.url, "/api/v3/command");
    assert.equal((req.body as any).name, "MoviesSearch");
    searched.push(...(req.body as any).movieIds);
    return { status: 201 };
  });
});
afterEach(() => fake.restore());

function job(status: string, ids: number[], processed = 0): number {
  const result = db
    .prepare("INSERT INTO system_jobs (task_name, status, total_items, processed_items, payload) VALUES (?, ?, ?, ?, ?)")
    .run(`job-${status}`, status, ids.length, processed, JSON.stringify(ids));
  return Number(result.lastInsertRowid);
}
const row = (id: number) => db.prepare("SELECT status, processed_items AS done FROM system_jobs WHERE id = ?").get(id) as { status: string; done: number };

describe("stepJob", () => {
  it("searches exactly one movie per step and completes after the last", async () => {
    const id = job("RUNNING", [101, 102]);
    assert.equal((await stepJob(id)).outcome, "stepped");
    assert.deepEqual(row(id), { status: "RUNNING", done: 1 });
    assert.equal((await stepJob(id)).outcome, "stepped");
    assert.deepEqual(row(id), { status: "COMPLETED", done: 2 });
    assert.deepEqual(searched, [101, 102]);
  });

  it("a manual step starts a PENDING job", async () => {
    const id = job("PENDING", [7]);
    assert.equal((await stepJob(id)).outcome, "stepped");
    assert.equal(row(id).status, "COMPLETED");
  });

  it("refuses a PAUSED job so that pausing actually pauses", async () => {
    const id = job("PAUSED", [1, 2]);
    const result = await stepJob(id);
    assert.equal(result.outcome, "skipped");
    assert.match(result.message, /PAUSED/);
    assert.deepEqual(row(id), { status: "PAUSED", done: 0 });
    assert.deepEqual(searched, []);
  });

  it("leaves COMPLETED and CANCELLED jobs alone, and reports unknown ids", async () => {
    assert.equal((await stepJob(job("COMPLETED", [1], 1))).outcome, "skipped");
    assert.equal((await stepJob(job("CANCELLED", [1]))).outcome, "skipped");
    assert.equal((await stepJob(999_999)).outcome, "failed");
    assert.deepEqual(searched, []);
  });

  it("completes a job whose progress already reached the end without searching", async () => {
    const id = job("RUNNING", [1, 2], 2);
    assert.equal((await stepJob(id)).outcome, "skipped");
    assert.equal(row(id).status, "COMPLETED");
    assert.deepEqual(searched, []);
  });

  it("releases the claim when Radarr fails, so the item is retried, not skipped", async () => {
    const id = job("RUNNING", [5, 6]);
    radarrDown = true;
    assert.equal((await stepJob(id)).outcome, "failed");
    assert.deepEqual(row(id), { status: "RUNNING", done: 0 });
    radarrDown = false;
    await stepJob(id);
    assert.deepEqual(searched, [5], "the failed item is searched on the retry");
  });

  it("two concurrent steps never search the same movie", async () => {
    const id = job("RUNNING", [601, 602]);
    const results = await Promise.all([stepJob(id), stepJob(id)]);
    assert.deepEqual(results.map((r) => r.outcome), ["stepped", "stepped"]);
    assert.deepEqual([...searched].sort(), [601, 602]);
    assert.equal(row(id).status, "COMPLETED");
  });

  it("the database claim is atomic: a stale second claimant loses", () => {
    const id = job("RUNNING", [1, 2]);
    const claim = () =>
      db
        .prepare("UPDATE system_jobs SET processed_items = processed_items + 1 WHERE id = ? AND processed_items = ? AND status IN ('PENDING','RUNNING')")
        .run(id, 0).changes;
    assert.equal(claim(), 1);
    assert.equal(claim(), 0);
  });

  it("does not step a job that was cancelled after it was read", async () => {
    const id = job("RUNNING", [1, 2]);
    db.prepare("UPDATE system_jobs SET status = 'CANCELLED' WHERE id = ?").run(id);
    assert.equal((await stepJob(id)).outcome, "skipped");
    assert.deepEqual(searched, []);
  });
});

describe("job runner", () => {
  it("advances only RUNNING jobs, one item per tick", async () => {
    const running = job("RUNNING", [101, 102, 103]);
    const pending = job("PENDING", [201]);
    const paused = job("PAUSED", [301]);

    for (let tick = 1; tick <= 3; tick++) {
      const result = await runJobRunnerTick();
      assert.equal(result?.jobId, running);
      assert.equal(row(running).done, tick);
    }
    assert.equal(row(running).status, "COMPLETED");
    assert.equal(await runJobRunnerTick(), null, "nothing left to do");
    assert.deepEqual(searched, [101, 102, 103]);
    assert.deepEqual(row(pending), { status: "PENDING", done: 0 });
    assert.deepEqual(row(paused), { status: "PAUSED", done: 0 });
  });

  it("picks the oldest RUNNING job first", async () => {
    const first = job("RUNNING", [1]);
    job("RUNNING", [2]);
    assert.equal((await runJobRunnerTick())?.jobId, first);
  });

  it("pauses a job after 3 consecutive failures instead of retrying forever", async () => {
    const id = job("RUNNING", [501, 502]);
    radarrDown = true;
    await runJobRunnerTick();
    await runJobRunnerTick();
    assert.equal(row(id).status, "RUNNING");
    await runJobRunnerTick();
    assert.deepEqual(row(id), { status: "PAUSED", done: 0 });
    assert.equal(await runJobRunnerTick(), null);
  });

  it("a success resets the failure count", async () => {
    const id = job("RUNNING", [1, 2, 3]);
    radarrDown = true;
    await runJobRunnerTick();
    await runJobRunnerTick();
    radarrDown = false;
    await runJobRunnerTick(); // succeeds -> counter cleared
    radarrDown = true;
    await runJobRunnerTick();
    await runJobRunnerTick();
    assert.equal(row(id).status, "RUNNING", "two more failures are below the threshold again");
  });
});

describe("getRunnerIntervalSeconds", () => {
  it("defaults to 60, allows 0 to disable, enforces a 10 second minimum, and ignores junk", () => {
    assert.equal(getRunnerIntervalSeconds(undefined), 60);
    assert.equal(getRunnerIntervalSeconds(""), 60);
    assert.equal(getRunnerIntervalSeconds("0"), 0);
    assert.equal(getRunnerIntervalSeconds("5"), 10);
    assert.equal(getRunnerIntervalSeconds("120"), 120);
    assert.equal(getRunnerIntervalSeconds("abc"), 60);
    assert.equal(getRunnerIntervalSeconds("-3"), 60);
  });
});
