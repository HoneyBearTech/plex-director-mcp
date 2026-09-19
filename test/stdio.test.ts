import "./setup.js";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const repo = path.resolve(import.meta.dirname, "..");

// stdout belongs to the MCP protocol: anything on it that isn't a JSON-RPC
// message can confuse a strict client. (dotenv's "injected env ... tip: ..."
// banner once went there.)
describe("stdout stays clean for MCP", () => {
  it("nothing in src writes to stdout with console.log", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && /console\.log\(/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(repo, full));
      }
    };
    walk(path.join(repo, "src"));
    assert.deepEqual(offenders, []);
  });

  it("loading a .env prints nothing (real dotenv, in a throwaway copy of env.ts)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plex-director-test-env-"));
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.copyFileSync(path.join(repo, "src", "env.ts"), path.join(dir, "src", "env.ts"));
      fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
      fs.writeFileSync(path.join(dir, ".env"), "PLEX_DIRECTOR_TEST_VALUE=loaded\n");
      fs.symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));

      const env = { ...process.env };
      delete env.PLEX_DIRECTOR_SKIP_DOTENV; // this copy must really load its own .env
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "-e", "await import('./src/env.ts'); process.stdout.write('[' + process.env.PLEX_DIRECTOR_TEST_VALUE + ']')"],
        { cwd: dir, env, encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "[loaded]", "the .env was loaded, and nothing else was written to stdout");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a real MCP handshake gets only JSON-RPC on stdout", async () => {
    const freePort = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plex-director-test-mcp-"));
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: repo,
      // The suite's isolation still applies: throwaway DB, no real .env, no credentials.
      env: { ...process.env, PLEX_DIRECTOR_DB_PATH: path.join(dir, "test.db"), WEB_PORT: String(freePort) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      const lines: string[] = [];
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          lines.push(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      });

      const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + "\n");
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !lines.some((l) => l.includes('"id":2'))) await new Promise((r) => setTimeout(r, 100));

      assert.ok(lines.length >= 2, "the server answered the handshake");
      for (const line of lines) {
        assert.doesNotThrow(() => JSON.parse(line), `stdout line is not JSON: ${JSON.stringify(line)}`);
      }
      const tools = JSON.parse(lines.find((l) => l.includes('"id":2'))!).result.tools.map((t: { name: string }) => t.name);
      assert.ok(tools.includes("search_plex_library") && tools.includes("check_indexer_health"), `tools: ${tools}`);
      for (const name of ["check_series_completeness", "find_series_gaps", "check_series_status", "diagnose_missing_episodes", "get_upcoming_episodes", "get_on_deck"]) {
        assert.ok(tools.includes(name), `missing ${name}; tools: ${tools}`);
      }
      // README.md states this number ("23 tools", "Twenty-three tools"); change them together.
      assert.equal(tools.length, 23, `tool count changed - update the counts in README.md too. tools: ${tools}`);
    } finally {
      child.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
