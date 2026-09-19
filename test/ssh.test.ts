import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { probeHost } from "../src/cluster.js";
import { db } from "../src/db.js";
import { checkHostKey, fingerprintFromHex, forgetHostKey, HostKeyMismatchError } from "../src/hostKeys.js";
import { setSetting } from "../src/settings.js";
import { runRemoteCommand } from "../src/ssh.js";
import { resetDb, startApp } from "./helpers.js";
import { generateKeyPair, startSshServer, type KeyPair, type TestSshServer } from "./sshServer.js";

let dir: string;
let client: KeyPair;
let server: TestSshServer;
let target: string; // "127.0.0.1:<port>", exactly as it would appear in UBUNTU_HOSTS

const storedFingerprint = (host: string) => (db.prepare("SELECT fingerprint FROM ssh_host_keys WHERE host = ?").get(host) as { fingerprint: string } | undefined)?.fingerprint;

function useKey(pair: KeyPair, passphrase?: string) {
  const file = path.join(dir, `key-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, pair.privateKey, { mode: 0o600 });
  process.env.SSH_KEY_PATH = file;
  if (passphrase) process.env.SSH_KEY_PASSPHRASE = passphrase;
  else delete process.env.SSH_KEY_PASSPHRASE;
}

beforeEach(async () => {
  await resetDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plex-director-test-ssh-"));
  client = generateKeyPair();
  server = await startSshServer({ authorizedPublicKey: client.publicKey });
  target = `127.0.0.1:${server.port}`;
  setSetting("SSH_USER", "tester");
  useKey(client);
});
afterEach(async () => {
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.SSH_KEY_PATH;
  delete process.env.SSH_KEY_PASSPHRASE;
});

describe("host key bookkeeping (trust on first use)", () => {
  it("formats a fingerprint the way OpenSSH does (SHA256: + unpadded base64)", () => {
    // sha256("abc")
    assert.equal(fingerprintFromHex("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"), "SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0");
  });

  it("remembers the first key, accepts it again, and refuses a different one", () => {
    assert.deepEqual(checkHostKey("h1", "SHA256:aaa"), { status: "new" });
    assert.deepEqual(checkHostKey("h1", "SHA256:aaa"), { status: "match" });
    assert.deepEqual(checkHostKey("h1", "SHA256:bbb"), { status: "mismatch", expected: "SHA256:aaa" });
    assert.deepEqual(checkHostKey("h2", "SHA256:bbb"), { status: "new" }, "hosts are tracked independently");
  });

  it("forgetting a host lets the next key be trusted", () => {
    checkHostKey("h1", "SHA256:aaa");
    assert.equal(forgetHostKey("h1"), true);
    assert.equal(forgetHostKey("h1"), false, "nothing left to forget");
    assert.deepEqual(checkHostKey("h1", "SHA256:bbb"), { status: "new" });
  });
});

describe("runRemoteCommand against a real SSH server", () => {
  it("connects, runs the command, and remembers the host's key on first use", async () => {
    assert.equal(await runRemoteCommand(target, "whatever"), "ok");
    assert.match(storedFingerprint(target) ?? "", /^SHA256:[A-Za-z0-9+/]{43}$/);
    assert.equal(server.commandsRun(), 1);
  });

  it("keeps working while the host presents the same key", async () => {
    await runRemoteCommand(target, "a");
    await runRemoteCommand(target, "b");
    assert.equal(server.commandsRun(), 2);
  });

  it("refuses a host whose key changed, says why, and never runs the command", async () => {
    await runRemoteCommand(target, "first");
    const real = storedFingerprint(target)!;
    db.prepare("UPDATE ssh_host_keys SET fingerprint = ? WHERE host = ?").run("SHA256:someOtherKeyThatWasRememberedEarlier", target); // as if the host's key had changed since

    await assert.rejects(runRemoteCommand(target, "second"), (error: unknown) => {
      assert.ok(error instanceof HostKeyMismatchError);
      assert.equal(error.expected, "SHA256:someOtherKeyThatWasRememberedEarlier");
      assert.equal(error.actual, real);
      assert.match(error.message, /host key for 127\.0\.0\.1:\d+ has changed/);
      return true;
    });
    assert.equal(server.commandsRun(), 1, "the second command was never sent");
  });

  it("trusts the new key once the old one has been forgotten", async () => {
    await runRemoteCommand(target, "first");
    db.prepare("UPDATE ssh_host_keys SET fingerprint = 'SHA256:stale' WHERE host = ?").run(target);
    await assert.rejects(runRemoteCommand(target, "blocked"), HostKeyMismatchError);

    forgetHostKey(target);
    assert.equal(await runRemoteCommand(target, "allowed"), "ok");
    assert.notEqual(storedFingerprint(target), "SHA256:stale");
  });

  it("a server presenting a different key than the one remembered for its address is refused", async () => {
    await runRemoteCommand(target, "first");
    const remembered = storedFingerprint(target)!;

    // A second server has a different host key. Remember the first server's key
    // under the second's address, as if the second were now answering there.
    const impostor = await startSshServer({ authorizedPublicKey: client.publicKey });
    const impostorTarget = `127.0.0.1:${impostor.port}`;
    try {
      db.prepare("INSERT INTO ssh_host_keys (host, fingerprint) VALUES (?, ?)").run(impostorTarget, remembered);
      await assert.rejects(runRemoteCommand(impostorTarget, "steal"), HostKeyMismatchError);
      assert.equal(impostor.commandsRun(), 0, "nothing was executed on the impostor");
    } finally {
      await impostor.close();
    }
  });
});

describe("runRemoteCommand: keys and configuration", () => {
  it("works with a passphrase-protected key when SSH_KEY_PASSPHRASE is set", async () => {
    const protectedPair = generateKeyPair("correct horse");
    await server.close();
    server = await startSshServer({ authorizedPublicKey: protectedPair.publicKey });
    target = `127.0.0.1:${server.port}`;

    useKey(protectedPair, "correct horse");
    assert.equal(await runRemoteCommand(target, "x"), "ok");
  });

  it("fails clearly for a passphrase-protected key with no or the wrong passphrase", async () => {
    const protectedPair = generateKeyPair("correct horse");
    await server.close();
    server = await startSshServer({ authorizedPublicKey: protectedPair.publicKey });
    target = `127.0.0.1:${server.port}`;

    useKey(protectedPair);
    await assert.rejects(runRemoteCommand(target, "x"), /passphrase/i);
    useKey(protectedPair, "wrong");
    await assert.rejects(runRemoteCommand(target, "x"), /passphrase|decrypt/i);
    assert.equal(server.commandsRun(), 0);
  });

  it("is rejected when the key isn't authorized on the host", async () => {
    useKey(generateKeyPair());
    await assert.rejects(runRemoteCommand(target, "x"), /authentication methods failed/i);
  });

  it("says so when SSH_KEY_PATH isn't set", async () => {
    delete process.env.SSH_KEY_PATH;
    await assert.rejects(runRemoteCommand(target, "x"), /SSH_KEY_PATH is not set/);
  });

  it("reports a host that isn't listening", async () => {
    await assert.rejects(runRemoteCommand("127.0.0.1:1", "x"), /ECONNREFUSED/);
  });
});

describe("probeHost and the dashboard's Trust new key", () => {
  const PROBE_OUTPUT = ["atlas", "12.5", "40.00", "4000", "10000", "3", "ombi,", "115G 57G 52%", "90000"].join("\n@@@FIELD@@@\n");

  beforeEach(async () => {
    await server.close();
    server = await startSshServer({ authorizedPublicKey: client.publicKey, output: PROBE_OUTPUT });
    target = `127.0.0.1:${server.port}`;
    setSetting("UBUNTU_HOSTS", target);
  });

  it("reads the host's health through the verified connection", async () => {
    const host = await probeHost(target);
    assert.equal(host.online, true);
    assert.equal(host.online && host.hostname, "atlas");
    assert.equal(host.online && host.cpuPercent, 12.5);
  });

  it("marks a host offline with the reason, and flags a changed host key", async () => {
    await probeHost(target);
    db.prepare("UPDATE ssh_host_keys SET fingerprint = 'SHA256:old' WHERE host = ?").run(target);

    const host = await probeHost(target);
    assert.equal(host.online, false);
    assert.ok(!host.online && host.hostKeyChanged);
    assert.equal(!host.online && host.hostKeyChanged?.expected, "SHA256:old");
    assert.match(!host.online ? host.error : "", /has changed/);

    const refused = await probeHost("127.0.0.1:1");
    assert.equal(refused.online, false);
    assert.match(!refused.online ? refused.error : "", /ECONNREFUSED/);
    assert.equal(!refused.online && refused.hostKeyChanged, undefined, "an ordinary failure is not a key change");
  });

  it("POST /api/nodes/trust-new-key forgets the key so the host comes back online", async () => {
    const app = await startApp();
    try {
      await probeHost(target);
      db.prepare("UPDATE ssh_host_keys SET fingerprint = 'SHA256:old' WHERE host = ?").run(target);
      assert.equal((await probeHost(target)).online, false);

      const post = (host: string) =>
        fetch(`${app.base}/api/nodes/trust-new-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host }) });

      assert.equal((await post("192.0.2.99")).status, 404, "only configured hosts can be named");
      assert.equal(storedFingerprint(target), "SHA256:old", "an unknown host didn't touch anything");

      const ok = await post(target);
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { ok: true, hadRememberedKey: true });
      assert.equal((await probeHost(target)).online, true);
    } finally {
      await app.close();
    }
  });

  it("the endpoint needs a login when WEB_PASSWORD is set", async () => {
    process.env.WEB_PASSWORD = "pw";
    const app = await startApp();
    try {
      const res = await fetch(`${app.base}/api/nodes/trust-new-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host: target }) });
      assert.equal(res.status, 401);
    } finally {
      delete process.env.WEB_PASSWORD;
      await app.close();
    }
  });
});
