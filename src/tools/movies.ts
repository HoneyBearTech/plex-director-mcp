import axios from "axios";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { server } from "../server.js";
import { radarrClient, tmdbClient, sabnzbdClient } from "../clients.js";
import { textReply, getErrorMessage } from "../util.js";
import { searchPlexLibrary, type PlexSearchArgs } from "./plex.js";
import { resolveActorFilmography } from "./discovery.js";

// /movie/lookup returns a TMDB-backed search result that, even for a movie
// already in the library, omits some fields the actual library record has
// (notably hasFile - see diagnoseMissingMedia below). Both tools need the
// real /movie record, not just the lookup hit, to trust hasFile/path/status.
async function findRadarrMatch(title: string): Promise<{ lookupMatch: any; primaryMatch: any | undefined } | null> {
  const lookupResponse = await radarrClient.get(`/api/v3/movie/lookup?term=${encodeURIComponent(title)}`);
  const lookupMovies = lookupResponse.data as Array<any>;

  if (!lookupMovies || lookupMovies.length === 0) {
    return null;
  }

  const lookupMatch = lookupMovies[0];
  const libraryResponse = await radarrClient.get("/api/v3/movie");
  const libraryMovies = libraryResponse.data as Array<any>;
  const normalizedTitle = String(lookupMatch.title || title).trim().toLowerCase();
  const primaryMatch = libraryMovies.find((movie: any) =>
    (lookupMatch.tmdbId && movie.tmdbId === lookupMatch.tmdbId) ||
    (String(movie.title || "").trim().toLowerCase() === normalizedTitle && movie.year === lookupMatch.year)
  );

  return { lookupMatch, primaryMatch };
}

async function checkMovieStatus(title: string): Promise<CallToolResult> {
  try {
    const match = await findRadarrMatch(title);
    if (!match) {
      return textReply(`❌ Movie "${title}" was not found in the Radarr database.`);
    }

    const { primaryMatch } = match;
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

async function diagnoseMissingMedia(title: string): Promise<CallToolResult> {
  const traceSteps: string[] = [];

  try {
    traceSteps.push(`🔍 Step 1: Querying Radarr for "${title}"...`);
    const match = await findRadarrMatch(title);

    if (!match) {
      return textReply(`❌ Trace Failed:\n"${title}" is completely unmanaged. It does not exist in your Radarr database.`);
    }

    const { lookupMatch, primaryMatch } = match;
    const movie = primaryMatch || lookupMatch;
    traceSteps.push(`  ↳ Found record: ${movie.title} (${movie.year}) [ID: ${movie.id || "Unassigned"}]`);

    if (!movie.monitored) {
      traceSteps.push("  ⚠️ Alert: This movie is NOT marked as monitored in Radarr. It will never look for releases automatically.");
    } else {
      traceSteps.push("  ✓ Status: Managed & Monitored.");
    }

    if (primaryMatch?.hasFile) {
      traceSteps.push(`  ✓ File Check: Radarr notes a file already exists at: ${primaryMatch.path}`);
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

// Shared registry: same handlers back both the MCP tool surface
// (registerMovieTools, below) and the web chat assistant
// (src/web/chat.ts), so a fix in one place applies everywhere and an
// LLM driving the web UI calls the exact same logic as an MCP client.
// Explicit shape so tools with different argument types (and required vs.
// optional fields) can live in one list that both surfaces iterate.
interface MovieTool {
  name: string;
  description: string;
  zodSchema: z.ZodRawShape;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: (args: any) => Promise<CallToolResult>;
}

export const movieTools: MovieTool[] = [
  {
    name: "check_movie_status",
    description: "Checks if a specific movie exists in the Radarr library on the Ubuntu cluster and returns its monitoring status with artwork.",
    zodSchema: {
      title: z.string().describe("The exact title of the movie to search for."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "The exact title of the movie to search for." },
      },
      required: ["title"],
    },
    handler: async ({ title }: { title: string }) => checkMovieStatus(title),
  },
  {
    name: "diagnose_missing_media",
    description: "Traces a movie through Radarr metadata, history, and active download client queues to pinpoint why it is missing.",
    zodSchema: {
      title: z.string().describe("The title of the media to diagnose."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "The title of the media to diagnose." },
      },
      required: ["title"],
    },
    handler: async ({ title }: { title: string }) => diagnoseMissingMedia(title),
  },
  {
    name: "search_plex_library",
    description:
      "Searches the movies actually in the user's Plex library (across all movie libraries, including 4K) by genre, actor, title, and/or release year. Filters can be combined, e.g. genre 'Horror' with year 1982. Use this to answer what the user owns or can watch; use check_movie_status for Radarr/download status of one specific movie.",
    zodSchema: {
      title: z.string().optional().describe("Part of the movie title."),
      genre: z.string().optional().describe("Genre name, e.g. 'Horror' or 'Science Fiction'."),
      actor: z.string().optional().describe("Full actor name, e.g. 'Harrison Ford'."),
      year: z.number().int().optional().describe("Release year."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return (default 25)."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Part of the movie title." },
        genre: { type: "string", description: "Genre name, e.g. 'Horror' or 'Science Fiction'." },
        actor: { type: "string", description: "Full actor name, e.g. 'Harrison Ford'." },
        year: { type: "integer", description: "Release year." },
        limit: { type: "integer", description: "Maximum results to return (default 25)." },
      },
      required: [] as string[],
    },
    handler: async (args: PlexSearchArgs) => searchPlexLibrary(args),
  },
  {
    name: "resolve_actor_filmography",
    description:
      "Resolves an actor's name to their official TMDb filmography, filtering out talk shows, self-appearances, and uncredited roles. When Plex is configured, marks which of those movies the user already has in their Plex library and which they don't. Use this to answer which of an actor's movies the user is missing.",
    zodSchema: {
      actorName: z.string().describe("The exact name of the actor (e.g., 'Harrison Ford')."),
      limit: z.number().int().min(1).max(100).optional().describe("How many titles to list, newest first (default 15)."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        actorName: { type: "string", description: "The exact name of the actor (e.g., 'Harrison Ford')." },
        limit: { type: "integer", description: "How many titles to list, newest first (default 15)." },
      },
      required: ["actorName"],
    },
    handler: async ({ actorName, limit }: { actorName: string; limit?: number }) => resolveActorFilmography(actorName, limit),
  },
];

// Movie lookup and missing-media diagnostics.
export function registerMovieTools() {
  for (const tool of movieTools) {
    server.tool(tool.name, tool.description, tool.zodSchema, tool.handler);
  }
}
