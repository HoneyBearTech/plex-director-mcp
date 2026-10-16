import { Router } from "express";
import { db, type SystemJobRow } from "../../db.js";
import { getErrorMessage } from "../../util.js";

export const jobsRouter = Router();

type JobRecord = Omit<SystemJobRow, "payload">;

// SQLite's CURRENT_TIMESTAMP is UTC but written as "YYYY-MM-DD HH:MM:SS" with
// no zone, which browsers would parse as local time. Make it an ISO string.
function toIso(sqliteTimestamp: string | null): string | null {
  return sqliteTimestamp ? `${sqliteTimestamp.replace(" ", "T")}Z` : null;
}

// Read-only on purpose: the dashboard's login is optional (WEB_PASSWORD), so
// starting, pausing, or cancelling jobs (which trigger Radarr searches) stays
// with the MCP tools (update_job_status / execute_next_job_step).
jobsRouter.get("/", (_req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, task_name, status, total_items, processed_items, created_at, updated_at FROM system_jobs ORDER BY id DESC LIMIT 50",
      )
      .all() as JobRecord[];

    res.json({
      jobs: rows.map((row) => ({
        id: row.id,
        taskName: row.task_name,
        status: row.status,
        totalItems: row.total_items,
        processedItems: row.processed_items,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});
