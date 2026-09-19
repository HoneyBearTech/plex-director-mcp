import { db } from "./db.js";
import { radarrClient } from "./clients.js";
import { safeJsonParse, getErrorMessage } from "./util.js";
import { sendDiscordNotification } from "./notify.js";

// Core of the background batch-job system, shared by the execute_next_job_step
// MCP tool and the automatic job runner (src/jobRunner.ts).

export interface StepResult {
  // stepped: one item was searched. skipped: nothing to do (or another process
  // got there first) - not a failure. failed: something went wrong.
  outcome: "stepped" | "skipped" | "failed";
  message: string;
}

// Advances one job by exactly one item (one Radarr MoviesSearch), so a large
// batch can't flood Radarr or the indexers.
//
// The step is claimed in the database *before* the search is sent: an atomic
// "processed_items = idx + 1 WHERE processed_items = idx". That makes it safe
// for two processes sharing this database (e.g. the Claude Desktop MCP server
// and the web/dev server) to both be stepping - only one wins each item, so no
// movie is searched twice. If the search then fails, the claim is released.
export async function stepJob(jobId: number): Promise<StepResult> {
  const job = db.prepare("SELECT * FROM system_jobs WHERE id = ?").get(jobId) as any;

  if (!job) {
    return { outcome: "failed", message: `Job #${jobId} does not exist.` };
  }

  if (job.status === "COMPLETED" || job.status === "CANCELLED") {
    return { outcome: "skipped", message: `Job #${jobId} is already marked as ${job.status}.` };
  }

  // A paused job stays paused until it is explicitly resumed; otherwise
  // "pause" wouldn't stop the automatic runner from picking it back up.
  if (job.status === "PAUSED") {
    return { outcome: "skipped", message: `Job #${jobId} is PAUSED. Resume it before stepping it.` };
  }

  const payloadIds: number[] = safeJsonParse<number[]>(job.payload, []);
  const currentIndex = Number(job.processed_items ?? 0);

  // A job can reach this branch when a previous invocation completed the
  // final item but the caller asks for another step.
  if (currentIndex >= payloadIds.length) {
    db.prepare("UPDATE system_jobs SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);
    return { outcome: "skipped", message: `✓ Job #${jobId} has successfully completed processing all structural items.` };
  }

  const claim = db
    .prepare(
      `UPDATE system_jobs
       SET processed_items = processed_items + 1, status = 'RUNNING', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND processed_items = ? AND status IN ('PENDING', 'RUNNING')`
    )
    .run(jobId, currentIndex);

  if (claim.changes === 0) {
    return { outcome: "skipped", message: `Job #${jobId} was just advanced or paused elsewhere; not stepping it again.` };
  }

  const targetMovieId = payloadIds[currentIndex];
  const nextIndex = currentIndex + 1;

  try {
    await radarrClient.post("/api/v3/command", {
      name: "MoviesSearch",
      movieIds: [targetMovieId],
    });
  } catch (error: unknown) {
    db.prepare(
      "UPDATE system_jobs SET processed_items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND processed_items = ?"
    ).run(currentIndex, jobId, nextIndex);
    return { outcome: "failed", message: `Failed processing step element index [${currentIndex}]: ${getErrorMessage(error)}` };
  }

  if (nextIndex >= payloadIds.length) {
    // Keep completion durable before notifying external systems.
    db.prepare("UPDATE system_jobs SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);

    // The helper absorbs webhook failures so a completed job remains a
    // successful operation even when Discord is temporarily offline.
    await sendDiscordNotification(
      "✅ Plex Director Batch Job Completed",
      `**Job Details:** ${job.task_name}\n` +
        `**Total Processed Items:** ${payloadIds.length}/${payloadIds.length}\n` +
        "**Target Nodes:** Managed Servarr Docker Cluster Architecture",
      3066993
    );
  }

  return {
    outcome: "stepped",
    message:
      `⚡ Step Complete: Successfully triggered rate-limited search command for item array index [${currentIndex}] (Movie ID: ${targetMovieId}).\n` +
      `Progress: ${nextIndex}/${payloadIds.length} items completed inside Job #${jobId}.`,
  };
}
