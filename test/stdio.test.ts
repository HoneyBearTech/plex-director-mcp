import "./setup.js";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ROUTES, SERVER_INSTRUCTIONS } from "../src/guidance.js";

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
        else if (entry.name.endsWith(".ts") && /console\.log\(/.test(fs.readFileSync(full, "utf8")))
          offenders.push(path.relative(repo, full));
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
        [
          "--import",
          "tsx",
          "-e",
          "await import('./src/env.ts'); process.stdout.write('[' + process.env.PLEX_DIRECTOR_TEST_VALUE + ']')",
        ],
        { cwd: dir, env, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout,
        "[loaded]",
        "the .env was loaded, and nothing else was written to stdout",
      );
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
      env: {
        ...process.env,
        PLEX_DIRECTOR_DB_PATH: path.join(dir, "test.db"),
        WEB_PORT: String(freePort),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      const lines: string[] = [];
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          lines.push(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      });

      const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !lines.some((l) => l.includes('"id":2')))
        await new Promise((r) => setTimeout(r, 100));

      assert.ok(lines.length >= 2, "the server answered the handshake");
      for (const line of lines) {
        assert.doesNotThrow(
          () => JSON.parse(line),
          `stdout line is not JSON: ${JSON.stringify(line)}`,
        );
      }
      const tools = JSON.parse(lines.find((l) => l.includes('"id":2'))!).result.tools.map(
        (t: { name: string }) => t.name,
      );
      assert.ok(
        tools.includes("search_plex_library") && tools.includes("check_indexer_health"),
        `tools: ${tools}`,
      );
      for (const name of [
        "check_series_completeness",
        "find_series_gaps",
        "check_series_status",
        "diagnose_missing_episodes",
        "get_upcoming_episodes",
        "get_on_deck",
        "search_episodes",
        "find_series_by_quality",
      ]) {
        assert.ok(tools.includes(name), `missing ${name}; tools: ${tools}`);
      }
      // The shared guidance (src/guidance.ts) reaches MCP clients and maps every tool.
      const init = JSON.parse(lines.find((l) => l.includes('"id":1'))!).result;
      assert.equal(init.instructions, SERVER_INSTRUCTIONS);
      const routed = new Set(ROUTES.flatMap((r) => r.tools));
      assert.deepEqual(
        [...routed].filter((t) => !tools.includes(t)),
        [],
        "guidance names a tool that doesn't exist",
      );
      assert.deepEqual(
        tools.filter((t: string) => !routed.has(t)),
        [],
        "a tool is missing from the guidance's ROUTES",
      );
      // README.md states this number ("26 tools", "Twenty-six tools"); change them together.
      assert.equal(
        tools.length,
        26,
        `tool count changed - update the counts in README.md too. tools: ${tools}`,
      );

      // Calling tools end to end: arguments reach the handler as the SDK parsed
      // them, and arguments that don't match the schema never reach it.
      const reply = async (id: number) => {
        const until = Date.now() + 15_000;
        while (Date.now() < until && !lines.some((l) => l.includes(`"id":${id}`)))
          await new Promise((r) => setTimeout(r, 50));
        const line = lines.find((l) => l.includes(`"id":${id}`));
        assert.ok(line, `no reply to request ${id}`);
        return JSON.parse(line);
      };
      const call = (id: number, name: string, args: unknown) =>
        send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

      call(3, "get_background_jobs", {});
      assert.match((await reply(3)).result.content[0].text, /No background batch jobs found/);

      call(4, "update_job_status", { jobId: 999, action: "CANCEL" });
      const missing = (await reply(4)).result;
      assert.equal(missing.isError, true);
      assert.match(missing.content[0].text, /Job #999 could not be found/);

      call(5, "update_job_status", { jobId: "not a number", action: "EXPLODE" });
      const invalid = await reply(5);
      assert.ok(
        invalid.error || invalid.result?.isError,
        `invalid arguments are refused: ${JSON.stringify(invalid)}`,
      );
      assert.doesNotMatch(JSON.stringify(invalid), /Successfully updated/);
    } finally {
      child.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
