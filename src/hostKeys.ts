import { db } from "./db.js";

// Trust on first use for SSH host keys: the first time a host is contacted its
// key fingerprint is remembered; afterwards a different key is refused. Hosts
// are keyed exactly as they are configured (including any :port).

export type HostKeyCheck = { status: "new" | "match" } | { status: "mismatch"; expected: string };

export class HostKeyMismatchError extends Error {
  constructor(
    readonly host: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(`The SSH host key for ${host} has changed (remembered ${expected}, host presented ${actual}). If the host was rebuilt or reinstalled, choose "Trust new key" on the Node Utilization page; otherwise don't - someone may be impersonating it.`);
    this.name = "HostKeyMismatchError";
  }
}

// ssh2 hands over the SHA-256 of the host key as hex; OpenSSH shows it as
// "SHA256:" plus unpadded base64, which is what people will recognise.
export function fingerprintFromHex(hex: string): string {
  return `SHA256:${Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "")}`;
}

// INSERT OR IGNORE then read, so two processes meeting a new host together
// end up trusting the same first key rather than racing.
export function checkHostKey(host: string, fingerprint: string): HostKeyCheck {
  const inserted = db.prepare("INSERT OR IGNORE INTO ssh_host_keys (host, fingerprint) VALUES (?, ?)").run(host, fingerprint).changes;
  if (inserted === 1) return { status: "new" };

  const stored = (db.prepare("SELECT fingerprint FROM ssh_host_keys WHERE host = ?").get(host) as { fingerprint: string }).fingerprint;
  return stored === fingerprint ? { status: "match" } : { status: "mismatch", expected: stored };
}

// Forget a host's remembered key, so the next connection trusts whatever it presents.
export function forgetHostKey(host: string): boolean {
  return db.prepare("DELETE FROM ssh_host_keys WHERE host = ?").run(host).changes > 0;
}
