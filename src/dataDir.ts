import fs from "node:fs";
import path from "node:path";

// From 1.3.0 the Docker image runs as uid 65532 instead of root, so a data
// folder made by an older version (or a bind mount created by root) is not
// writable any more. SQLite only says "unable to open database file"; this
// says what is wrong and how to fix it. Returns null when all is well.
export function dataDirProblem(dbPath: string): string | null {
  const dir = path.dirname(dbPath);
  try {
    // SQLite also writes its journal next to the database, so the folder
    // itself must be writable, not just the file.
    fs.accessSync(dir, fs.constants.W_OK);
    if (fs.existsSync(dbPath)) fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
    return null;
  } catch {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    const owner = uid === undefined ? "<uid>:<gid>" : `${uid}:${gid}`;
    return (
      `Plex Director cannot write its database at ${dbPath}` +
      `${uid === undefined ? "" : ` (running as uid ${uid})`}. ` +
      "Since version 1.3.0 the Docker image runs as a non-root user (65532) instead of root, so a data " +
      "folder created by an older version, or by root, is no longer writable. Fix it on the host with " +
      `\`sudo chown -R ${owner} <the folder or volume mounted at ${dir}>\`, or run the container ` +
      "as the folder's owner with --user. See docs/upgrading.md."
    );
  }
}
