import { Client as SSHClient } from "ssh2";
import fs from "node:fs";

// Execute one read-only telemetry command on a configured remote host.
export function runRemoteCommand(host: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let output = "";

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
      reject(err);
    }).connect({
      host: host,
      username: process.env.SSH_USER ?? "",
      privateKey: fs.readFileSync(process.env.SSH_KEY_PATH || "")
    });
  });
}
