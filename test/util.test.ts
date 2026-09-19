import "./setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AxiosError } from "axios";
import { escapeTableCell, getErrorMessage, rowLabel, rowPlays, safeJsonParse, textReply } from "../src/util.js";

describe("textReply", () => {
  it("wraps text as MCP content", () => {
    assert.deepEqual(textReply("hi"), { content: [{ type: "text", text: "hi" }] });
  });
  it("only sets isError when asked", () => {
    assert.equal("isError" in textReply("ok"), false);
    assert.equal(textReply("bad", true).isError, true);
  });
});

describe("getErrorMessage", () => {
  it("prefers an API error body's message over the generic axios one", () => {
    const err = new AxiosError("Request failed with status code 400", "ERR_BAD_REQUEST", undefined, null, {
      data: { message: "Movie already exists" },
      status: 400,
      statusText: "",
      headers: {},
      config: {} as any,
    });
    assert.equal(getErrorMessage(err), "Movie already exists");
  });
  it("falls back to the axios message, Error message, then a placeholder", () => {
    assert.equal(getErrorMessage(new AxiosError("timeout of 10000ms exceeded")), "timeout of 10000ms exceeded");
    assert.equal(getErrorMessage(new Error("boom")), "boom");
    assert.equal(getErrorMessage("nope"), "Unknown error");
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON and returns the fallback for empty or invalid input", () => {
    assert.deepEqual(safeJsonParse("[1,2]", []), [1, 2]);
    assert.deepEqual(safeJsonParse(null, [9]), [9]);
    assert.deepEqual(safeJsonParse("", [9]), [9]);
    assert.deepEqual(safeJsonParse("{not json", { a: 1 }), { a: 1 });
  });
});

// Regression: the MCP tool once ignored item.platform (rows showed "Unknown") and
// item.count (concurrent streams showed 0 plays).
describe("Tautulli row labels and play counts", () => {
  it("labels each category from the field that identifies it", () => {
    assert.equal(rowLabel("top_users", { friendly_name: "Sean", user: "sean" }), "Sean");
    assert.equal(rowLabel("top_users", { username: "sean" }), "sean");
    assert.equal(rowLabel("top_platforms", { platform: "iOS", title: "ignored" }), "iOS");
    assert.equal(rowLabel("top_libraries", { section_name: "Movies" }), "Movies");
    assert.equal(rowLabel("most_concurrent", { title: "Peak" }), "Peak");
    assert.equal(rowLabel("top_tv", { grandparent_title: "Severance", title: "Hello, Ms. Cobel" }), "Severance");
    assert.equal(rowLabel("top_movies", { title: "Heat" }), "Heat");
  });
  it("says Unknown when nothing identifies the row", () => {
    assert.equal(rowLabel("top_platforms", {}), "Unknown");
    assert.equal(rowLabel("top_movies", {}), "Unknown");
  });
  it("reads plays from total_plays, then play_count, then count, else 0", () => {
    assert.equal(rowPlays({ total_plays: 7, play_count: 1, count: 2 }), 7);
    assert.equal(rowPlays({ play_count: 3 }), 3);
    assert.equal(rowPlays({ count: 4 }), 4);
    assert.equal(rowPlays({ total_plays: 0, count: 4 }), 0);
    assert.equal(rowPlays({}), 0);
  });
});

// Regression: CodeQL js/incomplete-sanitization - escaping only "|" let a trailing
// backslash cancel the pipe's escape and corrupt the table row.
describe("escapeTableCell", () => {
  it("escapes pipes", () => assert.equal(escapeTableCell("a|b"), "a\\|b"));
  it("escapes backslashes before pipes", () => {
    assert.equal(escapeTableCell("trail\\"), "trail\\\\");
    assert.equal(escapeTableCell("x\\|y"), "x\\\\\\|y");
  });
  it("leaves ordinary text alone", () => assert.equal(escapeTableCell("Blade Runner 2049"), "Blade Runner 2049"));
});
