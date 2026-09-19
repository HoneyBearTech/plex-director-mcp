// Loaded before every test file (`node --import ./test/setup.ts --test`). Node
// runs each test file in its own process, so each file gets its own throwaway
// database and a clean environment.
//
// Nothing in the suite may touch a real service, a real database, or a real
// credential, so this:
//  1. skips loading the developer's .env,
//  2. points the app at a temporary SQLite file,
//  3. clears any service/credential variables exported in the shell,
//  4. makes every HTTP request fail unless a test installs its own fake.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import axios from "axios";

// Order matters: clear the shell's app variables FIRST, then set our own.
// (The pattern below also matches PLEX_DIRECTOR_*, so doing this the other way
// round deletes the very switches that keep the suite away from the real
// .env and database - which is exactly how this once went wrong.)
const APP_ENV = /^(RADARR|SONARR|PROWLARR|SABNZBD|QBITTORRENT|TAUTULLI|PLEX|TMDB|UBUNTU|SSH|DISCORD|WEB|ANTHROPIC|JOB_RUNNER|BACKUP|CLUSTER)_/;
for (const key of Object.keys(process.env)) {
  if (APP_ENV.test(key)) delete process.env[key];
}

process.env.PLEX_DIRECTOR_SKIP_DOTENV = "1";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plex-director-test-"));
process.env.PLEX_DIRECTOR_DB_PATH = path.join(dir, "test.db");
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));

// axios.create() copies these defaults, so every client created after this
// point (all of them - clients.ts loads later) refuses to touch the network.
axios.defaults.adapter = async (config) => {
  throw new Error(`Network access is disabled in tests (${String(config.method).toUpperCase()} ${config.url})`);
};
