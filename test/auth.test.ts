import "./setup.js";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { Request, Response } from "express";
import { createSessionToken, isAuthEnabled, passwordMatches, requireAuth, verifySessionToken } from "../src/web/auth.js";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  process.env.WEB_PASSWORD = "correct horse";
});

describe("password check", () => {
  it("accepts the password and rejects everything else", () => {
    assert.equal(passwordMatches("correct horse"), true);
    assert.equal(passwordMatches("correct horse "), false);
    assert.equal(passwordMatches("Correct horse"), false);
    assert.equal(passwordMatches(""), false);
    assert.equal(passwordMatches("x".repeat(10_000)), false);
  });
  it("auth is on exactly when a password is set (whitespace counts as unset)", () => {
    assert.equal(isAuthEnabled(), true);
    process.env.WEB_PASSWORD = "   ";
    assert.equal(isAuthEnabled(), false);
    delete process.env.WEB_PASSWORD;
    assert.equal(isAuthEnabled(), false);
  });
});

describe("session tokens", () => {
  it("round-trips a fresh token", () => {
    assert.equal(verifySessionToken(createSessionToken()), true);
  });
  it("expires after 7 days", () => {
    const issued = Date.now();
    const token = createSessionToken(issued);
    assert.equal(verifySessionToken(token, issued + 6 * DAY), true);
    assert.equal(verifySessionToken(token, issued + 7 * DAY + 1), false);
  });
  it("rejects a tampered signature, a forged expiry, and malformed values", () => {
    const token = createSessionToken();
    const [expiry, signature] = token.split(".") as [string, string];
    assert.equal(verifySessionToken(`${expiry}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`), false);
    assert.equal(verifySessionToken(`${Number(expiry) + 10 * DAY}.${signature}`), false, "extending the expiry invalidates the signature");
    for (const bad of [undefined, "", "abc", ".", `${expiry}.`, `.${signature}`, `${token}.extra`, "1.2.3"]) {
      assert.equal(verifySessionToken(bad), false, `rejects ${JSON.stringify(bad)}`);
    }
  });
  it("changing the password signs everyone out", () => {
    const token = createSessionToken();
    process.env.WEB_PASSWORD = "a different password";
    assert.equal(verifySessionToken(token), false);
    process.env.WEB_PASSWORD = "correct horse";
    assert.equal(verifySessionToken(token), true, "and the original password's sessions work again");
  });
});

describe("requireAuth middleware", () => {
  function run(cookie?: string) {
    const req = { headers: cookie ? { cookie } : {} } as unknown as Request;
    let status = 200;
    let body: unknown;
    let nextCalled = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as unknown as Response;
    requireAuth(req, res, () => void (nextCalled = true));
    return { status, body, nextCalled };
  }

  it("lets everything through when no password is set", () => {
    delete process.env.WEB_PASSWORD;
    assert.equal(run().nextCalled, true);
  });
  it("returns 401 without a valid session cookie", () => {
    const result = run();
    assert.equal(result.nextCalled, false);
    assert.equal(result.status, 401);
    assert.equal(run("pd_session=garbage").status, 401);
    assert.equal(run("other=1").status, 401);
  });
  it("accepts a valid session cookie among others", () => {
    assert.equal(run(`theme=dark; pd_session=${createSessionToken()}; x=1`).nextCalled, true);
  });
});
