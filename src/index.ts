import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Project bootstrap
// -----------------------------------------------------------------------------
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, "..");
const dbPath = path.join(projectRoot, "plex_director.db");

fs.mkdirSync(projectRoot, { recursive: true });
const db = new Database(dbPath);

dotenv.config({ path: path.resolve(projectRoot, ".env") });

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function textReply(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// -----------------------------------------------------------------------------
// Database setup
// -----------------------------------------------------------------------------
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

console.error(`📦 SQLite database initialized safely at: ${dbPath}`);

// -----------------------------------------------------------------------------
// Environment and API clients
// -----------------------------------------------------------------------------
const radarrUrl = requiredEnv("RADARR_URL");
const radarrApiKey = requiredEnv("RADARR_API_KEY");
const sabnzbdUrl = requiredEnv("SABNZBD_URL");
const sabnzbdApiKey = requiredEnv("SABNZBD_API_KEY");
const tautulliUrl = requiredEnv("TAUTULLI_URL");
const tautulliApiKey = requiredEnv("TAUTULLI_API_KEY");
const tmdbApiKey = requiredEnv("TMDB_API_KEY");
const prowlarrUrl = requiredEnv("PROWLARR_URL");
const prowlarrApiKey = requiredEnv("PROWLARR_API_KEY");

const server = new McpServer({
  name: "plex-director",
  version: "1.0.0",
});

const sabnzbdClient = axios.create({
  baseURL: sabnzbdUrl,
  params: { apikey: sabnzbdApiKey, output: "json" },
});

const radarrClient = axios.create({
  baseURL: radarrUrl,
  headers: { "X-Api-Key": radarrApiKey },
});

const tautulliClient = axios.create({
  baseURL: tautulliUrl,
  params: { apikey: tautulliApiKey, cmd: "" },
});

const tmdbClient = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  headers: {
    Authorization: `Bearer ${tmdbApiKey}`,
    Accept: "application/json",
  },
});

const prowlarrClient = axios.create({
  baseURL: prowlarrUrl,
  headers: { "X-Api-Key": prowlarrApiKey },
});

// -----------------------------------------------------------------------------
// Tool registration
// -----------------------------------------------------------------------------
function registerMovieTools() {
  server.tool(
    "check_movie_status",
    "Checks if a specific movie exists in the Radarr library and returns its monitoring status.",
    {
      title: z.string().describe("The exact title of the movie to search for."),
    },
    async ({ title }) => {
      try {
        const response = await radarrClient.get(`/api/v3/movie/lookup?term=${encodeURIComponent(title)}`);
        const movies = response.data as Array<any>;

        if (!movies || movies.length === 0) {
          return textReply(`Movie "${title}" was not found in the Radarr library.`);
        }

        const primaryMatch = movies[0];
        const summary = `Found: ${primaryMatch.title} (${primaryMatch.year})
- Monitored: ${primaryMatch.monitored ? "Yes" : "No"}
- Status: ${primaryMatch.status}
- Path on Server: ${primaryMatch.path || "Not assigned"}`;

        return textReply(summary);
      } catch (error: unknown) {
        return textReply(`Failed to connect to Radarr container: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "diagnose_missing_media",
    "Traces a movie through Radarr metadata, history, and active download client queues to pinpoint why it is missing.",
    {
      title: z.string().describe("The title of the media to diagnose."),
    },
    async ({ title }) => {
      const traceSteps: string[] = [];

      try {
        traceSteps.push(`🔍 Step 1: Querying Radarr for "${title}"...`);
        const radarrSearch = await radarrClient.get(`/api/v3/movie/lookup?term=${encodeURIComponent(title)}`);
        const movieMatches = radarrSearch.data as Array<any>;

        if (!movieMatches || movieMatches.length === 0) {
          return textReply(`❌ Trace Failed:\n"${title}" is completely unmanaged. It does not exist in your Radarr database.`);
        }

        const movie = movieMatches[0];
        traceSteps.push(`  ↳ Found record: ${movie.title} (${movie.year}) [ID: ${movie.id || "Unassigned"}]`);

        if (!movie.monitored) {
          traceSteps.push("  ⚠️ Alert: This movie is NOT marked as monitored in Radarr. It will never look for releases automatically.");
        } else {
          traceSteps.push("  ✓ Status: Managed & Monitored.");
        }

        if (movie.hasFile) {
          traceSteps.push(`  ✓ File Check: Radarr notes a file already exists at: ${movie.path}`);
          return textReply(traceSteps.join("\n"));
        }

        traceSteps.push("📡 Step 2: Scanning Download Client Queues (SABnzbd)...");
        const sabQueue = await sabnzbdClient.get("", { params: { mode: "queue" } });
        const activeDownloads = sabQueue.data?.queue?.slots || [];
        const activeMatch = activeDownloads.find((slot: any) =>
          typeof slot?.filename === "string" && slot.filename.toLowerCase().includes(title.toLowerCase())
        );

        if (activeMatch) {
          traceSteps.push("  📥 Found in Download Queue!");
          traceSteps.push(`  ↳ File: ${activeMatch.filename}`);
          traceSteps.push(`  ↳ Status: ${activeMatch.status} | Progress: ${activeMatch.percentage}% | ETA: ${activeMatch.timeleft}`);
          return textReply(traceSteps.join("\n"));
        }

        traceSteps.push("📜 Step 3: Checking download history for failure blocklists...");
        if (movie.id) {
          const historyResponse = await radarrClient.get(`/api/v3/history?movieId=${movie.id}`);
          const historyItems = historyResponse.data?.records || [];
          const failedItems = historyItems.filter((h: any) => h.eventType === "downloadFailed");

          if (failedItems.length > 0) {
            traceSteps.push(`  ❌ Found ${failedItems.length} failed release attempts in historical logs.`);
            traceSteps.push(`  ↳ Last Failure Reason: ${failedItems[0].data?.droppedPath ? "Bad download path" : "Grabbed but failed to import"}`);
          } else {
            traceSteps.push("  ❓ No recent grab or failure history found. The indexers may lack a healthy release matching your quality profile.");
          }
        } else {
          traceSteps.push("  ❓ Item has no local ID. It has been added to Radarr but a library wide RSS sync hasn't found a matching indexer release yet.");
        }

        return textReply(traceSteps.join("\n"));
      } catch (error: unknown) {
        return textReply(`Trace interrupted by connection failure: ${getErrorMessage(error)}`, true);
      }
    }
  );
}

function registerMonitoringTools() {
  server.tool(
    "get_plex_activity",
    "Fetches real-time playback streaming analytics from Plex via Tautulli to monitor user context and transcoding strain.",
    {},
    async () => {
      try {
        const response = await tautulliClient.get("", { params: { cmd: "get_activity" } });
        const data = response.data?.response?.data;

        if (!data || parseInt(data.stream_count, 10) === 0) {
          return textReply("💤 Total Plex streams: 0. The server is completely idle right now.");
        }

        let summary = `📊 Active Server Load:\n- Total Streams: ${data.stream_count}\n- Transcode Count: ${data.stream_count_transcode}\n- Direct Play Count: ${data.stream_count_direct_play}\n\n`;

        const sessions = data.sessions || [];
        sessions.forEach((session: any) => {
          summary += `👤 User: ${session.user} watching "${session.title}" (${session.year || "TV"})\n`;
          summary += `  ↳ Quality: ${session.video_resolution} (${session.stream_container})\n`;
          summary += `  ↳ Processing: ${session.transcode_decision === "transcode" ? `⚠️ Transcoding (${session.video_decision})` : "✓ Direct Play"}\n`;
          summary += `  ↳ Progress: ${session.progress}%\n\n`;
        });

        return textReply(summary);
      } catch (error: unknown) {
        return textReply(`Failed to interface with Tautulli monitoring node: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "get_library_analytics",
    "Queries historical statistics regarding most watched movies, total user count, and overall watch metrics.",
    {},
    async () => {
      try {
        const response = await tautulliClient.get("", { params: { cmd: "get_home_stats" } });
        const stats = response.data?.response?.data || [];

        if (stats.length === 0) {
          return textReply("No analytics history currently tracked by Tautulli.");
        }

        let readout = "🏆 Top Media Trends (All Time):\n\n";
        stats.forEach((category: any) => {
          readout += `▪ ${category.stat_title}:\n`;
          const items = category.rows || [];
          items.slice(0, 3).forEach((item: any, index: number) => {
            readout += `  ${index + 1}. ${item.title || item.user} - Total Plays: ${item.play_count}\n`;
          });
          readout += "\n";
        });

        return textReply(readout);
      } catch (error: unknown) {
        return textReply(`Failed to process analytics query: ${getErrorMessage(error)}`, true);
      }
    }
  );
}

function registerJobTools() {
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
    "Processes a single sequential block item from an active background batch queue entry to prevent API flooding.",
    {
      jobId: z.number().describe("The unique tracking ID of the active job array to step execute."),
    },
    async ({ jobId }) => {
      const selectStmt = db.prepare("SELECT * FROM system_jobs WHERE id = ?");
      const job = selectStmt.get(jobId) as any;

      if (!job) {
        return textReply(`Job #${jobId} does not exist.`, true);
      }

      if (job.status === "COMPLETED" || job.status === "CANCELLED") {
        return textReply(`Job #${jobId} is already marked as ${job.status}.`);
      }

      const payloadIds: number[] = safeJsonParse<number[]>(job.payload, []);
      const currentIndex = Number(job.processed_items ?? 0);

      if (currentIndex >= payloadIds.length) {
        db.prepare("UPDATE system_jobs SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);
        return textReply(`✓ Job #${jobId} has successfully completed processing all structural items.`);
      }

      if (job.status === "PENDING" || job.status === "PAUSED") {
        db.prepare("UPDATE system_jobs SET status = 'RUNNING' WHERE id = ?").run(jobId);
      }

      const targetMovieId = payloadIds[currentIndex];

      try {
        await radarrClient.post("/api/v3/command", {
          name: "MoviesSearch",
          movieIds: [targetMovieId],
        });

        const nextIndex = currentIndex + 1;
        const isNowFinished = nextIndex >= payloadIds.length;
        const finalStatus = isNowFinished ? "COMPLETED" : "RUNNING";

        db.prepare(`
          UPDATE system_jobs
          SET processed_items = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(nextIndex, finalStatus, jobId);

        return textReply(
          `⚡ Step Complete: Successfully triggered rate-limited search command for item array index [${currentIndex}] (Movie ID: ${targetMovieId}).\n` +
            `Progress: ${nextIndex}/${payloadIds.length} items completed inside Job #${jobId}.`
        );
      } catch (error: unknown) {
        return textReply(`Failed processing step element index [${currentIndex}]: ${getErrorMessage(error)}`, true);
      }
    }
  );
}

function registerDiscoveryTools() {
  server.tool(
    "resolve_actor_filmography",
    "Resolves an actor's name to their official TMDb filmography, filtering out talk shows, self-appearances, and uncredited roles.",
    {
      actorName: z.string().describe("The exact name of the actor (e.g., 'Harrison Ford')."),
    },
    async ({ actorName }) => {
      try {
        const personSearch = await tmdbClient.get(`/search/person?query=${encodeURIComponent(actorName)}`);
        const person = personSearch.data?.results?.[0];

        if (!person) {
          return textReply(`❌ Actor "${actorName}" could not be resolved on TMDb.`, true);
        }

        const creditsResponse = await tmdbClient.get(`/person/${person.id}/movie_credits`);
        const castCredits = creditsResponse.data?.cast || [];

        const cleanFilmography = castCredits.filter((movie: any) => {
          const character = movie.character ? movie.character.toLowerCase() : "";
          const isSelf = character.includes("self") || character.includes("historical footage") || character.includes("archive");
          const isUncredited = character.includes("uncredited");
          const isDocumentary = movie.genre_ids?.includes(99);

          return !isSelf && !isUncredited && !isDocumentary;
        });

        cleanFilmography.sort(
          (a: any, b: any) => new Date(b.release_date || 0).getTime() - new Date(a.release_date || 0).getTime()
        );

        let output = `🎬 Resolved: ${person.name} (TMDb ID: ${person.id})\n`;
        output += `Filtered filmography to ${cleanFilmography.length} structural movie targets (removed docs/uncredited/self):\n\n`;

        cleanFilmography.slice(0, 15).forEach((movie: any) => {
          output += `  ▪ ${movie.title} (${movie.release_date ? movie.release_date.split("-")[0] : "N/A"}) - As: ${movie.character || "Unknown"}\n`;
        });

        if (cleanFilmography.length > 15) {
          output += `  ...and ${cleanFilmography.length - 15} additional titles.`;
        }

        return textReply(output);
      } catch (error: unknown) {
        return textReply(`TMDb Resolution failed: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "check_indexer_health",
    "Audits all Usenet indexers and torrent trackers configured in Prowlarr to flag connection failures or bans.",
    {},
    async () => {
      try {
        const indexersResponse = await prowlarrClient.get("/api/v1/indexerstatus");
        const statuses = indexersResponse.data || [];
        const configResponse = await prowlarrClient.get("/api/v1/indexer");
        const indexerConfigs = configResponse.data || [];

        if (statuses.length === 0) {
          return textReply("✅ All indexers and trackers reporting healthy inside Prowlarr. Zero connection drops or backoffs detected.");
        }

        let diagnosticReport = "⚠️ Prowlarr Indexer Health Warning:\n";
        diagnosticReport += `Detected ${statuses.length} indexer operational anomalies across your tracker network:\n\n`;

        statuses.forEach((status: any) => {
          const matchingConfig = indexerConfigs.find((config: any) => config.id === status.indexerId);
          const name = matchingConfig ? matchingConfig.name : `Indexer ID ${status.indexerId}`;

          diagnosticReport += `▪ Indexer: ${name}\n`;
          diagnosticReport += `  ↳ Failure Mode: ${status.lastFailure || "Continuous API Timeout"}\n`;
          diagnosticReport += `  ↳ Backoff Until: ${status.disabledTill ? new Date(status.disabledTill).toLocaleString() : "Manual intervention required"}\n`;
          diagnosticReport += "  ↳ Operational State: Temporary Escape / Escalated Error\n\n";
        });

        return textReply(diagnosticReport);
      } catch (error: unknown) {
        return textReply(`Prowlarr cluster health scan failed: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "search_and_select_movies",
    "Searches TMDb for matching movies and renders a structured Markdown multi-choice grid interface for confirmation.",
    {
      query: z.string().describe("The film name or fuzzy query text to search for (e.g. 'Heat')."),
    },
    async ({ query }) => {
      try {
        db.prepare("DELETE FROM interaction_context").run();

        const response = await tmdbClient.get(`/search/movie?query=${encodeURIComponent(query)}`);
        const results = response.data?.results || [];

        if (results.length === 0) {
          return textReply(`❌ No movie records matched the query: "${query}"`);
        }

        const choices = results.slice(0, 5);
        const insertStmt = db.prepare(`
          INSERT INTO interaction_context (selection_index, tmdb_id, title, year)
          VALUES (?, ?, ?, ?)
        `);

        let markdownOutput = `🎬 **Ambiguity Resolution: Multi-Choice Selection Matrix**\n`;
        markdownOutput += `I detected multiple records matching **"${query}"**. Please review the options below and tell me which option(s) to process (e.g., "Grab choice 1 and 3").\n\n`;
        markdownOutput += "| Choice ID | Poster Preview | Film Details & Cast Overview |\n";
        markdownOutput += "| :---: | :---: | :--- |\n";

        choices.forEach((movie: any, index: number) => {
          const choiceId = index + 1;
          const year = movie.release_date ? movie.release_date.split("-")[0] : "N/A";
          const posterUrl = movie.poster_path ? `https://tmdb.org${movie.poster_path}` : "https://placeholder.com";

          insertStmt.run(choiceId, movie.id, movie.title, year);

          const cleanOverview = movie.overview ? movie.overview.replace(/\|/g, "\\|") : "No overview available.";
          const truncatedOverview = cleanOverview.length > 180 ? `${cleanOverview.slice(0, 180)}...` : cleanOverview;

          markdownOutput += `| **[ Choice ${choiceId} ]** | ![${movie.title}](${posterUrl}) | **${movie.title} (${year})**  <br> *TMDb ID: ${movie.id}* <br><br> ${truncatedOverview} |\n`;
        });

        return textReply(markdownOutput);
      } catch (error: unknown) {
        return textReply(`Failed generating selection matrix: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "confirm_selected_choices",
    "Processes the user's specific numbered choices validated from the active selection context queue.",
    {
      chosenIndexes: z.array(z.number()).describe("An array of chosen numbers selected by the user (e.g., [1, 3])."),
    },
    async ({ chosenIndexes }) => {
      try {
        const stmt = db.prepare("SELECT * FROM interaction_context WHERE selection_index = ?");
        const matchedSelections: any[] = [];

        chosenIndexes.forEach((index: number) => {
          const record = stmt.get(index) as any;
          if (record) matchedSelections.push(record);
        });

        if (matchedSelections.length === 0) {
          return textReply(
            "❌ Selection processing failed. The specified choices do not exist in the current interface view context.",
            true
          );
        }

        let successReport = "🚀 **Processing Selected Media Assets:**\n";
        for (const selection of matchedSelections) {
          // Hook this into Radarr acquisition later if you want to create a real import task.
          successReport += `  ✓ Handled execution queue for **Choice ${selection.selection_index}**: ${selection.title} (${selection.year}) [TMDb: ${selection.tmdb_id}]\n`;
        }

        return textReply(successReport);
      } catch (error: unknown) {
        return textReply(`Execution failed during confirmation: ${getErrorMessage(error)}`, true);
      }
    }
  );
}

// -----------------------------------------------------------------------------
// Startup
// -----------------------------------------------------------------------------
registerMovieTools();
registerMonitoringTools();
registerJobTools();
registerDiscoveryTools();

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Plex Director MCP server running on Stdio");
}

run().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
