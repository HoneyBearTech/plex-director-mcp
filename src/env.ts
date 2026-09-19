import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(sourceDirectory, "..");

// The test suite sets PLEX_DIRECTOR_SKIP_DOTENV so a developer's real .env
// (credentials, webhook URLs) can never leak into a test run.
if (!process.env.PLEX_DIRECTOR_SKIP_DOTENV) {
  // quiet: dotenv otherwise prints "injected env (N) from .env // tip: ..." to
  // stdout, and stdout belongs to the MCP protocol (JSON-RPC only).
  dotenv.config({ path: path.resolve(projectRoot, ".env"), quiet: true });
}
