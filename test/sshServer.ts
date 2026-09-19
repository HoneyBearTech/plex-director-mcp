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

export function generateKeyPair(passphrase?: string): KeyPair {
  const pair = utils.generateKeyPairSync("ed25519", passphrase ? { passphrase, cipher: "aes256-ctr", rounds: 16 } : {});
  return { privateKey: pair.private, publicKey: pair.public };
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
