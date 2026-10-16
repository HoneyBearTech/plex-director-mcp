import "./setup.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { trustProxyFromEnv } from "../src/web/trustProxy.js";
import { startApp } from "./helpers.js";

afterEach(() => {
  delete process.env.WEB_TRUST_PROXY;
  delete process.env.WEB_PASSWORD;
});

describe("trustProxyFromEnv", () => {
  it("trusts nothing when unset or empty", () => {
    assert.equal(trustProxyFromEnv(undefined), false);
    assert.equal(trustProxyFromEnv(" , "), false);
  });

  it("accepts addresses, subnets and Express's named ranges", () => {
    assert.deepEqual(trustProxyFromEnv(" 192.168.40.10, 192.168.40.0/24 ,fd00::/8,loopback"), [
      "192.168.40.10",
      "192.168.40.0/24",
      "fd00::/8",
      "loopback",
    ]);
  });

  it("refuses values that would trust whoever connects, or aren't addresses", () => {
    for (const bad of [
      "true",
      "1",
      "*",
      "proxy.lan",
      "192.168.40.0/33",
      "10.0.0.1/8/1",
      "::1/129",
    ]) {
      assert.throws(() => trustProxyFromEnv(bad), /WEB_TRUST_PROXY must list/, bad);
    }
  });

  it("stops the dashboard from starting with an invalid value", async () => {
    process.env.WEB_TRUST_PROXY = "true";
    await assert.rejects(startApp(), /WEB_TRUST_PROXY must list/);
  });
});

// The login limit: 10 failed attempts per client per 15 minutes.
describe("login rate limit behind a proxy", () => {
  const fail = (base: string, from: string) =>
    fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": from },
      body: JSON.stringify({ password: "wrong" }),
    });

  it("counts each real client separately when the proxy is trusted", async () => {
    process.env.WEB_PASSWORD = "pw";
    process.env.WEB_TRUST_PROXY = "loopback";
    const app = await startApp();
    try {
      for (let i = 0; i < 10; i++) assert.equal((await fail(app.base, "203.0.113.1")).status, 401);
      assert.equal((await fail(app.base, "203.0.113.1")).status, 429, "that client is limited");
      assert.equal((await fail(app.base, "203.0.113.2")).status, 401, "another one is not");
    } finally {
      await app.close();
    }
  });

  it("can't be dodged with a made-up X-Forwarded-For when no proxy is trusted", async () => {
    process.env.WEB_PASSWORD = "pw";
    const app = await startApp();
    try {
      for (let i = 0; i < 10; i++)
        assert.equal((await fail(app.base, `198.51.100.${i}`)).status, 401);
      assert.equal((await fail(app.base, "198.51.100.99")).status, 429);
    } finally {
      await app.close();
    }
  });
});
