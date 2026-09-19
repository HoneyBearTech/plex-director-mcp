import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { server } from "../src/server.js";
import { APP_VERSION } from "../src/version.js";

const packageVersion = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version;

describe("MCP server version", () => {
  it("is the version in package.json", () => {
    assert.equal(APP_VERSION, packageVersion);
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+/);
  });

  it("is what the MCP server announces to clients", () => {
    const info = (server as any).server._serverInfo;
    assert.deepEqual({ name: info.name, version: info.version }, { name: "plex-director", version: packageVersion });
  });
});
