import "./setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { z } from "zod";
import { server } from "../src/server.js";
import { movieTools, registerMovieTools } from "../src/tools/movies.js";

// Every movie tool declares its arguments twice: as a zod shape (for MCP
// clients) and as a JSON schema (for the web chat's model). They're written by
// hand, so nothing else stops the two from drifting apart.
describe("movieTools", () => {
  it("has unique, non-empty names and descriptions", () => {
    const names = movieTools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    for (const tool of movieTools) {
      assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
      assert.ok(tool.description.length > 20, `${tool.name} has a description`);
    }
  });

  for (const tool of movieTools) {
    it(`${tool.name}: zod shape and JSON schema declare the same arguments`, () => {
      const zodKeys = Object.keys(tool.zodSchema).sort();
      const jsonKeys = Object.keys(tool.inputSchema.properties).sort();
      assert.deepEqual(jsonKeys, zodKeys);
    });

    it(`${tool.name}: the same arguments are required in both`, () => {
      const zodRequired = Object.entries(tool.zodSchema)
        .filter(([, schema]) => !(schema as z.ZodType).safeParse(undefined).success)
        .map(([key]) => key)
        .sort();
      assert.deepEqual([...(tool.inputSchema.required ?? [])].sort(), zodRequired);
    });
  }

  // The web chat hands the model's tool input straight to the handler, so the
  // handler must check it against the zod shape itself (the MCP SDK does too).
  it("rejects input that does not match the zod shape before running the tool", async () => {
    const tool = movieTools.find((t) => t.name === "check_movie_status");
    assert.ok(tool);
    for (const input of [{}, { title: 42 }, undefined, "Heat"]) {
      const result = await tool.handler(input);
      assert.equal(result.isError, true, `${JSON.stringify(input)} is rejected`);
      const [block] = result.content;
      assert.ok(block?.type === "text");
      assert.match(block.text, /^Invalid arguments for check_movie_status: /);
    }
  });

  it("rejects an out-of-range value the JSON schema alone would let through", async () => {
    const tool = movieTools.find((t) => t.name === "search_plex_library");
    assert.ok(tool);
    const result = await tool.handler({ mediaType: "music" });
    assert.equal(result.isError, true);
    const [block] = result.content;
    assert.ok(block?.type === "text");
    assert.match(block.text, /^Invalid arguments for search_plex_library: .*mediaType/s);
  });

  it("registers every tool with the MCP server", () => {
    registerMovieTools();
    const registered = Object.keys((server as any)._registeredTools);
    for (const tool of movieTools)
      assert.ok(registered.includes(tool.name), `${tool.name} is registered`);
  });
});
