import axios from "axios";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { server } from "../server.js";
import { radarrClient, tmdbClient, sabnzbdClient } from "../clients.js";
import { textReply, getErrorMessage } from "../util.js";

// Movie lookup and missing-media diagnostics.
export function registerMovieTools() {
  server.tool(
    "check_movie_status",
    "Checks if a specific movie exists in the Radarr library on the Ubuntu cluster and returns its monitoring status with artwork.",
    {
      title: z.string().describe("The exact title of the movie to search for."),
    },
    async ({ title }): Promise<CallToolResult> => {
      try {
        const lookupResponse = await radarrClient.get(`/api/v3/movie/lookup?term=${encodeURIComponent(title)}`);
        const lookupMovies = lookupResponse.data as Array<any>;

        if (!lookupMovies || lookupMovies.length === 0) {
          return textReply(`❌ Movie "${title}" was not found in the Radarr database.`);
        }

        const libraryResponse = await radarrClient.get("/api/v3/movie");
        const libraryMovies = libraryResponse.data as Array<any>;
        const lookupMatch = lookupMovies[0];
        const normalizedTitle = String(lookupMatch.title || title).trim().toLowerCase();
        const primaryMatch = libraryMovies.find((movie: any) =>
          (lookupMatch.tmdbId && movie.tmdbId === lookupMatch.tmdbId) ||
          (String(movie.title || "").trim().toLowerCase() === normalizedTitle && movie.year === lookupMatch.year)
        );

        if (!primaryMatch) {
          return textReply(`❌ Movie "${title}" was found in Radarr search results but is not currently in the library.`);
        }

        let posterUrl = primaryMatch.images?.find((image: any) => image.coverType === "poster")?.remoteUrl;
        if (!posterUrl && primaryMatch.tmdbId) {
          const tmdbResponse = await tmdbClient.get(`/movie/${primaryMatch.tmdbId}`);
          const posterPath = tmdbResponse.data?.poster_path;
          if (posterPath) {
            posterUrl = `https://image.tmdb.org/t/p/w500${posterPath}`;
          }
        }
        posterUrl ||= `https://placehold.co/600x900?text=${encodeURIComponent(primaryMatch.title)}`;

        let richLayout = `### 🎬 Media Asset Profile: ${primaryMatch.title} (${primaryMatch.year})\n\n`;
        richLayout += `![${primaryMatch.title} poster](${posterUrl})\n\n`;
        richLayout += `| Overview & File Specifications | Artwork Preview |\n`;
        richLayout += `| :--- | :---: |\n`;
        richLayout += `| **Database Tracking Status:** <br> ▪ Monitored: ${primaryMatch.monitored ? "🟢 Yes" : "⚪ No"} <br> ▪ Library Status: \`${primaryMatch.status}\` <br><br> **File System Allocation:** <br> ▪ Path: \`${primaryMatch.path || "No Path Assigned"}\` <br> ▪ Existing File: ${primaryMatch.hasFile ? "✅ Available" : "⏳ Missing / Wanted"} | Poster artwork above |\n\n`;

        if (primaryMatch.overview) {
          richLayout += `**Storyline Synopsis:**\n> *${primaryMatch.overview}*\n`;
        }

        try {
          const posterResponse = await axios.get<ArrayBuffer>(posterUrl, { responseType: "arraybuffer" });
          const mimeType = String(posterResponse.headers["content-type"] || "image/jpeg").split(";")[0] || "image/jpeg";

          return {
            content: [
              { type: "text" as const, text: richLayout },
              {
                type: "image" as const,
                data: Buffer.from(posterResponse.data).toString("base64"),
                mimeType,
              },
            ],
          };
        } catch {
          return textReply(richLayout);
        }
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
