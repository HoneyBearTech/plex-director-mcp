import { z } from "zod";
import { server } from "../server.js";
import { db } from "../db.js";
import { radarrClient } from "../clients.js";
import { textReply, getErrorMessage } from "../util.js";
import { stepJob } from "../jobs.js";

// Durable batch-job planning, execution, and status management.
export function registerJobTools() {
  server.tool(
    "get_background_jobs",
    "Retrieves active, pending, or completed persistent media processing jobs running on the server cluster.",
    {},
    async () => {
      const stmt = db.prepare("SELECT * FROM system_jobs ORDER BY created_at DESC LIMIT 10");
      const jobs = stmt.all() as any[];

      if (jobs.length === 0) {
        return textReply("No background batch jobs found in the queue.");
      }

      const output = jobs
        .map(
          (job) =>
            `Job #${job.id} - [${job.status}] ${job.task_name}\nProgress: ${job.processed_items}/${job.total_items} items | Created: ${job.created_at}`
        )
        .join("\n\n");

      return textReply(output);
    }
  );

  server.tool(
    "update_job_status",
    "Updates the operational state of an active or pending background batch job.",
    {
      jobId: z.number().describe("The unique ID of the target job"),
      action: z.enum(["PAUSE", "RESUME", "CANCEL"]).describe("The action to execute on the queue runtime."),
    },
    async ({ jobId, action }) => {
      let targetStatus = "PENDING";
      if (action === "PAUSE") targetStatus = "PAUSED";
      if (action === "RESUME") targetStatus = "RUNNING";
      if (action === "CANCEL") targetStatus = "CANCELLED";

      const stmt = db.prepare("UPDATE system_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
      const result = stmt.run(targetStatus, jobId);

      if (result.changes === 0) {
        return textReply(`Job #${jobId} could not be found to modify.`, true);
      }

      return textReply(`Successfully updated Job #${jobId} status to ${targetStatus}.`);
    }
  );

  server.tool(
    "plan_media_upgrade",
    "Evaluates and safely schedules a controlled batch upgrade for specified media classes while enforcing storage policies.",
    {
      mediaType: z.enum(["movie", "tv"]).describe("The structural classification targeting upgrades."),
      targetResolution: z.enum(["1080p", "4k"]).describe("The target processing quality resolution threshold."),
      maxBatchSize: z.number().optional().default(25).describe("Limits the maximum number of edits in a single batch."),
    },
    async ({ mediaType, targetResolution, maxBatchSize }) => {
      if (mediaType === "tv") {
        return textReply(
          "🚫 POLICY VIOLATION ERRONEOUS ACTION REJECTED:\n" +
            "Permanent structural policy dictation states TV shows are strictly storage-conscious. " +
            "Mass quality upgrades across TV classifications are permanently prohibited to prevent storage starvation.",
          true
        );
      }

      try {
        const response = await radarrClient.get("/api/v3/movie");
        const allMovies = response.data || [];

        const upgradeCandidates = allMovies.filter((movie: any) => {
          const currentResolution = movie.movieFile?.quality?.quality?.name || "";
          const isAlreadyHighQuality =
            currentResolution.includes("1080") ||
            currentResolution.includes("2160") ||
            currentResolution.includes("4K");

          return (movie.monitored && !movie.hasFile) || (movie.monitored && movie.hasFile && !isAlreadyHighQuality);
        });

        if (upgradeCandidates.length === 0) {
          return textReply(`✓ Scan complete. Zero movies found requiring a forced upgrade to ${targetResolution}.`);
        }

        const targetedBatch = upgradeCandidates.slice(0, maxBatchSize);
        const targetIds = targetedBatch.map((movie: any) => movie.id);
        const insertStmt = db.prepare(`
          INSERT INTO system_jobs (task_name, status, total_items, processed_items, payload)
          VALUES (?, 'PENDING', ?, 0, ?)
        `);

        const taskName = `Upgrade ${targetedBatch.length} movies below 1080p to selective profile`;
        const result = insertStmt.run(taskName, targetedBatch.length, JSON.stringify(targetIds));

        let outputSummary = `🏗️ Upgrade Batch Job Successfully Scheduled (Job #${result.lastInsertRowid})\n`;
        outputSummary += `- Target: Upgrade to ${targetResolution}\n`;
        outputSummary += `- Eligible Candidates Detected: ${upgradeCandidates.length}\n`;
        outputSummary += `- Scheduled in This Safe Batch: ${targetedBatch.length}\n\n`;
        outputSummary += "Sample Items Enqueued:\n";

        targetedBatch.slice(0, 5).forEach((movie: any) => {
          outputSummary += `  ▪ ${movie.title} (${movie.year})\n`;
        });

        if (targetedBatch.length > 5) {
          outputSummary += `  ...and ${targetedBatch.length - 5} more.\n\n`;
        }

        outputSummary += " Run 'get_background_jobs' or instruct execution routines to advance processing limits safely.";

        return textReply(outputSummary);
      } catch (error: unknown) {
        return textReply(`Failed to formulate structural upgrade process: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "execute_next_job_step",
    "Processes a single sequential block item from an active background batch queue entry to prevent API flooding. (Jobs that have been started are also advanced automatically, one item per minute, by the job runner.)",
    {
      jobId: z.number().describe("The unique tracking ID of the active job array to step execute."),
    },
    async ({ jobId }) => {
      const result = await stepJob(jobId);
      return textReply(result.message, result.outcome === "failed");
    }
  );
}
