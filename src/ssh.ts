import { Client as SSHClient } from "ssh2";
import fs from "node:fs";
import { getSetting } from "./settings.js";
import { checkHostKey, fingerprintFromHex, HostKeyMismatchError } from "./hostKeys.js";

// "192.168.1.10" or "192.168.1.10:2222". The host string is also the key the
// remembered host key is stored under.
function splitHostPort(target: string): { host: string; port: number } {
  const [, host, port] = /^(.+):(\d{1,5})$/.exec(target) ?? [];
  return host && port ? { host, port: Number(port) } : { host: target, port: 22 };
}

export interface RemoteCommandLimits {
  // The whole call: connecting, logging in and running the command.
  timeoutMs?: number;
  // Telemetry output is a few hundred bytes; far more is not what was asked
  // for, so the connection is dropped rather than buffered.
  maxOutputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

// Execute one read-only telemetry command on a configured remote host.
export function runRemoteCommand(
  target: string,
  command: string,
  limits: RemoteCommandLimits = {},
): Promise<string> {
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = limits.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const keyPath = process.env.SSH_KEY_PATH;
    if (!keyPath) {
      return reject(
        new Error("SSH_KEY_PATH is not set, so there is no private key to log in with."),
      );
    }

    const { host, port } = splitHostPort(target);
    const conn = new SSHClient();
    const chunks: Buffer[] = [];
    let received = 0;
    let hostKeyProblem: HostKeyMismatchError | undefined;

    // Settle once, and always close the connection.
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString().trim());
    };
    const timer = setTimeout(
      () => finish(new Error(`${target} did not finish within ${timeoutMs / 1000} seconds.`)),
      timeoutMs,
    );

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return finish(err);
          stream.on("data", (data: Buffer) => {
            received += data.length;
            if (received > maxOutputBytes) {
              finish(
                new Error(
                  `${target} sent more than ${maxOutputBytes} bytes of output; stopped reading.`,
                ),
              );
              return;
            }
            chunks.push(data);
          });
          stream.on("close", () => finish(null));
        });
      })
      .on("error", (err) => {
        // A refused host key surfaces from ssh2 as a generic handshake error;
        // report the real reason instead.
        finish(hostKeyProblem ?? err);
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
        readyTimeout: timeoutMs,
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
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
