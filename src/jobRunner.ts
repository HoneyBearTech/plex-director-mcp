import { db } from "./db.js";
import { stepJob, type StepResult } from "./jobs.js";
import { sendDiscordNotification } from "./notify.js";

// Automatically advances background jobs that have been started (status
// RUNNING), one item per tick, so a scheduled batch doesn't need a manual
// execute_next_job_step call per movie.
//
// Deliberately conservative:
// - PENDING jobs never start on their own; a person has to start (RESUME) one.
// - PAUSED / CANCELLED / COMPLETED jobs are never touched.
// - One item per tick across all jobs, so the search rate stays flat.
// - A job that fails several times in a row (e.g. Radarr is down) is paused
//   and reported instead of retrying forever.

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 10;
const MAX_CONSECUTIVE_FAILURES = 3;

const consecutiveFailures = new Map<number, number>();

export function getRunnerIntervalSeconds(raw: string | undefined = process.env.JOB_RUNNER_INTERVAL_SECONDS): number {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_INTERVAL_SECONDS;

  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.error(`Ignoring invalid JOB_RUNNER_INTERVAL_SECONDS "${trimmed}"; using ${DEFAULT_INTERVAL_SECONDS}s.`);
    return DEFAULT_INTERVAL_SECONDS;
  }
  if (seconds === 0) return 0;
  return Math.max(seconds, MIN_INTERVAL_SECONDS);
}

// One tick of the runner. Exported so it can be exercised without waiting on a timer.
export async function runJobRunnerTick(): Promise<{ jobId: number; result: StepResult } | null> {
  const job = db.prepare("SELECT id, task_name FROM system_jobs WHERE status = 'RUNNING' ORDER BY id LIMIT 1").get() as
    | { id: number; task_name: string }
    | undefined;
  if (!job) return null;

  const result = await stepJob(job.id);

  if (result.outcome === "failed") {
    const failures = (consecutiveFailures.get(job.id) ?? 0) + 1;
    console.error(`Job runner: job #${job.id} step failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${result.message}`);

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      consecutiveFailures.delete(job.id);
      db.prepare("UPDATE system_jobs SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RUNNING'").run(job.id);
      console.error(`Job runner: paused job #${job.id} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
      await sendDiscordNotification(
        "⏸️ Plex Director Job Paused",
        `**Job #${job.id}:** ${job.task_name}\n` +
          `Paused automatically after ${MAX_CONSECUTIVE_FAILURES} consecutive failed steps.\n` +
          `**Last error:** ${result.message}\n` +
          "Resume it once the problem is fixed.",
        15105570
      );
    } else {
      consecutiveFailures.set(job.id, failures);
    }
  } else {
    consecutiveFailures.delete(job.id);
  }

  return { jobId: job.id, result };
}

export function startJobRunner(): NodeJS.Timeout | null {
  const seconds = getRunnerIntervalSeconds();
  if (seconds === 0) {
    console.error("Job runner disabled (JOB_RUNNER_INTERVAL_SECONDS=0).");
    return null;
  }

  console.error(`Job runner: advancing RUNNING jobs one item every ${seconds}s.`);
  let busy = false;
  const timer = setInterval(() => {
    // A slow Radarr call shouldn't let ticks pile up on top of each other.
    if (busy) return;
    busy = true;
    runJobRunnerTick()
      .catch((error) => console.error("Job runner tick failed:", error))
      .finally(() => {
        busy = false;
      });
  }, seconds * 1000);
  timer.unref();
  return timer;
}
