import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { dataDirProblem } from "../src/dataDir.js";

// Root can write anywhere, so the permission cases only mean something as
// another user (CI and a normal dev machine both are).
const asRoot = process.getuid?.() === 0;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "plex-director-datadir-"));
after(() => {
  for (const entry of fs.readdirSync(scratch, { recursive: true, withFileTypes: true }))
    fs.chmodSync(path.join(entry.parentPath, entry.name), 0o700);
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("dataDirProblem", () => {
  it("is fine with a writable folder and no database yet", () => {
    const dir = fs.mkdtempSync(path.join(scratch, "fresh-"));
    assert.equal(dataDirProblem(path.join(dir, "plex_director.db")), null);
  });

  it("is fine with a writable folder and a writable database", () => {
    const dir = fs.mkdtempSync(path.join(scratch, "existing-"));
    fs.writeFileSync(path.join(dir, "plex_director.db"), "");
    assert.equal(dataDirProblem(path.join(dir, "plex_director.db")), null);
  });

  it("explains a folder the user cannot write, with the chown to run", { skip: asRoot }, () => {
    const dir = fs.mkdtempSync(path.join(scratch, "locked-"));
    fs.chmodSync(dir, 0o555);
    const dbPath = path.join(dir, "plex_director.db");
    const problem = dataDirProblem(dbPath);
    assert.ok(problem);
    assert.ok(problem.includes(dbPath), "names the database path");
    assert.match(problem, /non-root user \(65532\)/);
    assert.ok(
      problem.includes(`sudo chown -R ${process.getuid?.()}:${process.getgid?.()}`),
      "gives the chown for the user it runs as",
    );
  });

  it("explains a database file the user cannot write", { skip: asRoot }, () => {
    const dir = fs.mkdtempSync(path.join(scratch, "readonly-file-"));
    const dbPath = path.join(dir, "plex_director.db");
    fs.writeFileSync(dbPath, "");
    fs.chmodSync(dbPath, 0o444);
    assert.match(dataDirProblem(dbPath) ?? "", /cannot write its database/);
  });
});
