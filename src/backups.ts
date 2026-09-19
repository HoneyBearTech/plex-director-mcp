import type { AxiosInstance } from "axios";
import { radarrClient, sonarrClient, prowlarrClient } from "./clients.js";
import { isConfigured } from "./settings.js";
import { getErrorMessage } from "./util.js";

// Asks each configured Servarr app to create its own built-in database backup,
// waits for the app to finish, and confirms a new backup file actually appeared
// in the app's backup list. The backups stay in each app's own backup folder on
// its own host; nothing is copied anywhere.

export interface BackupOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export interface BackupOutcome {
  app: string;
  state: "done" | "warning" | "failed" | "skipped";
  message: string;
}

const APPS = [
  { name: "Radarr", service: "RADARR", client: radarrClient, api: "/api/v3" },
  { name: "Sonarr", service: "SONARR", client: sonarrClient, api: "/api/v3" },
  { name: "Prowlarr", service: "PROWLARR", client: prowlarrClient, api: "/api/v1" },
] as const;

const FINISHED = new Set(["completed", "failed", "aborted", "cancelled"]);
// Backup timestamps come from the app's clock, and so does the command's start
// time, so the two can be compared directly; this only absorbs sub-second rounding.
const CLOCK_SLACK_MS = 5_000;

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function formatTime(iso: string): string {
  return `${iso.replace("T", " ").replace(/:\d\dZ$/, "")} UTC`;
}

async function backUpOne(app: (typeof APPS)[number], client: AxiosInstance, { pollMs, timeoutMs }: Required<BackupOptions>): Promise<BackupOutcome> {
  const { name, api } = app;
  try {
    let command = (await client.post(`${api}/command`, { name: "Backup" })).data;
    const deadline = Date.now() + timeoutMs;

    while (!FINISHED.has(String(command.status))) {
      if (Date.now() >= deadline) {
        return { app: name, state: "warning", message: `the backup was started but hadn't finished after ${Math.round(timeoutMs / 1000)}s. Large databases can take over a minute (Sonarr took 69s in testing), so it will most likely finish on its own - check ${name}'s System > Backup page.` };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      command = (await client.get(`${api}/command/${command.id}`)).data;
    }

    if (command.status !== "completed") {
      return { app: name, state: "failed", message: `the backup ${command.status}${command.message ? `: ${command.message}` : ""}.` };
    }

    const backups: Array<{ name: string; time: string; size?: number }> = (await client.get(`${api}/system/backup`)).data ?? [];
    const newest = [...backups].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
    if (!newest) {
      return { app: name, state: "warning", message: `the backup finished, but ${name} lists no backup files.` };
    }

    // "Completed" only says the command ran; the point is that a file now exists.
    const startedAt = Date.parse(command.started ?? command.queued ?? "");
    if (!Number.isNaN(startedAt) && Date.parse(newest.time) < startedAt - CLOCK_SLACK_MS) {
      return { app: name, state: "warning", message: `the backup command finished, but no new file appeared - the newest backup is still ${newest.name} from ${formatTime(newest.time)}.` };
    }

    return { app: name, state: "done", message: `backup completed: ${newest.name} (${formatBytes(newest.size ?? 0)}, ${formatTime(newest.time)}).` };
  } catch (error: unknown) {
    return { app: name, state: "failed", message: getErrorMessage(error) };
  }
}

export async function runServarrBackups(options: BackupOptions = {}): Promise<{ text: string; isError: boolean }> {
  // Kept under a minute: many MCP clients give up on a tool call around then, and
  // a backup that outlasts the wait is reported as still running, not as a failure.
  const settings = { pollMs: options.pollMs ?? 1500, timeoutMs: options.timeoutMs ?? 55_000 };

  const outcomes = await Promise.all(
    APPS.map((app) =>
      isConfigured(app.service)
        ? backUpOne(app, app.client, settings)
        : Promise.resolve<BackupOutcome>({ app: app.name, state: "skipped", message: "not configured, skipped." })
    )
  );

  const icon = { done: "✅", warning: "⚠️", failed: "❌", skipped: "⏭️" } as const;
  const succeeded = outcomes.some((o) => o.state === "done" || o.state === "warning");
  const attempted = outcomes.some((o) => o.state !== "skipped");

  if (!attempted) {
    return { text: "❌ None of Radarr, Sonarr or Prowlarr is configured, so there is nothing to back up.", isError: true };
  }

  let text = "💾 **Servarr backups**\n";
  for (const o of outcomes) text += `  ${icon[o.state]} ${o.app}: ${o.message}\n`;
  text += "\nEach backup is stored in that app's own backup folder on its host; this tool does not copy it anywhere.";
  return { text, isError: !succeeded };
}
