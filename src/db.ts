import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { projectRoot } from "./env.js";

const dataDir = path.join(projectRoot, "data");
const dbPath = path.join(dataDir, "plex_director.db");

fs.mkdirSync(dataDir, { recursive: true });
export const db: Database.Database = new Database(dbPath);

// Keep job state durable so long-running media operations can resume across MCP restarts.
db.exec(`
  CREATE TABLE IF NOT EXISTS system_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Store the user's current interactive multi-choice selection state for follow-up confirmation.
db.exec(`
  CREATE TABLE IF NOT EXISTS interaction_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selection_index INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    year TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Service configuration set via the web UI's Settings page. Overrides .env
// once saved; .env only seeds a key's initial value on first boot.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

console.error(`📦 SQLite database initialized safely at: ${dbPath}`);
