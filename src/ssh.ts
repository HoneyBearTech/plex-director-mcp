import { Client as SSHClient } from "ssh2";
import fs from "node:fs";
import { getSetting } from "./settings.js";
import { checkHostKey, fingerprintFromHex, HostKeyMismatchError } from "./hostKeys.js";

// "192.168.1.10" or "192.168.1.10:2222". The host string is also the key the
// remembered host key is stored under.
function splitHostPort(target: string): { host: string; port: number } {
  const match = /^(.+):(\d{1,5})$/.exec(target);
  return match ? { host: match[1]!, port: Number(match[2]) } : { host: target, port: 22 };
}

// Execute one read-only telemetry command on a configured remote host.
export function runRemoteCommand(target: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const keyPath = process.env.SSH_KEY_PATH;
    if (!keyPath) {
      return reject(new Error("SSH_KEY_PATH is not set, so there is no private key to log in with."));
    }

    const { host, port } = splitHostPort(target);
    const conn = new SSHClient();
    let output = "";
    let hostKeyProblem: HostKeyMismatchError | undefined;

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        stream.on("data", (data: any) => { output += data.toString(); });
        stream.on("close", () => {
          conn.end();
          resolve(output.trim());
        });
      });
    }).on("error", (err) => {
      // A refused host key surfaces from ssh2 as a generic handshake error;
      // report the real reason instead.
      reject(hostKeyProblem ?? err);
    });

    try {
      conn.connect({
        host,
        port,
        // SSH_USER is a dynamic setting (editable via the Nodes tab); the
        // private key stays a server-side file path, never typed into the
        // browser or stored in the database.
        username: getSetting("SSH_USER"),
        privateKey: fs.readFileSync(keyPath),
        // Only needed for a passphrase-protected key.
        ...(process.env.SSH_KEY_PASSPHRASE ? { passphrase: process.env.SSH_KEY_PASSPHRASE } : {}),
        hostHash: "sha256",
        hostVerifier: (keyHash: string) => {
          const actual = fingerprintFromHex(keyHash);
          const check = checkHostKey(target, actual);
          if (check.status === "mismatch") {
            hostKeyProblem = new HostKeyMismatchError(target, check.expected, actual);
            return false;
          }
          return true;
        },
      });
    } catch (error) {
      reject(error);
    }
  });
}
