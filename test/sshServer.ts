import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import type { ParsedKey } from "ssh2";

// ssh2 is CommonJS: its Server and utils don't survive a named ESM import at runtime.
const { Server, utils } = createRequire(import.meta.url)("ssh2") as typeof import("ssh2");

// A real SSH server on localhost for testing the client end to end: it
// presents a host key, accepts public-key login from one authorized key, and
// answers every exec request with canned output.

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

// ssh2's ed25519 generator produces a key that ssh2 itself cannot parse back
// (about 0.4% of the time: 3,403 of 867,381 in a measured sample). A suite that
// generates ~50 keys per run therefore failed at random about 1 run in 5, so
// every key is checked with ssh2's own parser and regenerated if it is bad.
export function generateKeyPair(passphrase?: string): KeyPair {
  for (let attempt = 0; attempt < 25; attempt++) {
    const pair = utils.generateKeyPairSync("ed25519", passphrase ? { passphrase, cipher: "aes256-ctr", rounds: 16 } : {});
    const usable = !(utils.parseKey(pair.private, passphrase) instanceof Error) && !(utils.parseKey(pair.public) instanceof Error);
    if (usable) return { privateKey: pair.private, publicKey: pair.public };
  }
  throw new Error("Could not generate a usable SSH key pair");
}

export interface TestSshServer {
  port: number;
  hostKey: KeyPair;
  // How many commands this server actually executed.
  commandsRun: () => number;
  close: () => Promise<void>;
}

export async function startSshServer(opts: { hostKey?: KeyPair; authorizedPublicKey: string; user?: string; output?: string }): Promise<TestSshServer> {
  const hostKey = opts.hostKey ?? generateKeyPair();
  const user = opts.user ?? "tester";
  const authorized = utils.parseKey(opts.authorizedPublicKey) as ParsedKey;
  let commands = 0;

  const server = new Server({ hostKeys: [hostKey.privateKey] }, (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.method !== "publickey" || ctx.username !== user) return ctx.reject(["publickey"]);
      if (ctx.key.algo !== authorized.type || Buffer.compare(ctx.key.data, authorized.getPublicSSH()) !== 0) return ctx.reject(["publickey"]);
      // A publickey probe has no signature yet; accepting it tells the client to sign.
      if (ctx.signature && !authorized.verify(ctx.blob!, ctx.signature, ctx.hashAlgo)) return ctx.reject(["publickey"]);
      ctx.accept();
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        accept().on("exec", (acceptExec) => {
          commands++;
          const stream = acceptExec();
          stream.write(opts.output ?? "ok\n");
          stream.exit(0);
          stream.end();
        });
      });
    });
    client.on("error", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    hostKey,
    commandsRun: () => commands,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
