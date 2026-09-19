import axios from "axios";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { server } from "../server.js";
import { radarrClient, tmdbClient, sabnzbdClient } from "../clients.js";
import { textReply, getErrorMessage } from "../util.js";
import { getOnDeck, searchPlexLibrary, type OnDeckArgs, type PlexSearchArgs } from "./plex.js";
import { resolveActorFilmography, type FilmographyOptions } from "./discovery.js";
import { checkSeriesCompleteness, findSeriesGaps, type SeriesGapOptions } from "./series.js";
import { checkSeriesStatus, diagnoseMissingEpisodes, type DiagnoseOptions } from "./seriesDiagnosis.js";
import { getUpcomingEpisodes, type UpcomingOptions } from "./upcoming.js";
import { searchEpisodes, type EpisodeSearchArgs } from "./plexEpisodes.js";

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
      "Searches the movies and TV shows actually in the user's Plex library (across all movie and show libraries, including 4K) by genre, actor, title, release year, and/or library. Filters can be combined, e.g. genre 'Horror' with year 1982, or genre 'Horror' with library '4k'. " +
      "Pass mediaType 'movie' when the user asks about movies/films, 'show' for TV/series/shows, and leave it out (any) when the question is about titles in general, e.g. everything with an actor; a show in several libraries is one result, with its season and episode counts. Some libraries (such as Sports) may be left out unless named in the library filter. " +
      "Use this to answer what the user owns or can watch; use check_movie_status for Radarr/download status of one specific movie. " +
      "Watch state: use watched 'unwatched' (never played), 'inProgress' (started but not finished - this is the complete list of unfinished titles, unlike get_on_deck's short recent list) or 'watched' (finished), and notWatchedInYears for 'haven't watched in N years' (a never-watched title counts from when it was added); they are for the Plex account the app is connected with. sort orders by recentlyAdded, lastWatched or leastRecentlyWatched instead of by title. Also filter by network (or movie studio), contentRating (TV-MA, R...), minRating (audience rating 0-10), yearFrom/yearTo (a decade is 1990 to 1999) and addedWithinDays ('what showed up this week?'). Plex does not know whether a show is continuing or ended; use Sonarr tools for that. " +
      "Always express a narrowing the user asks for (4K, a genre, a year, unwatched...) as a filter here rather than filtering results yourself, because the results table shown to the user contains exactly the rows this returns. " +
      "The default limit is small: when the user wants everything ('all', 'every', 'list them'), pass limit 500; if the reply says more matches remain, call again with the offset it gives.",
    zodSchema: {
      title: z.string().optional().describe("Part of the movie or show title."),
      mediaType: z.enum(["movie", "show", "any"]).optional().describe("Search only movies, only TV shows, or both (default any)."),
      genre: z.string().optional().describe("Genre name, e.g. 'Horror' or 'Science Fiction'."),
      actor: z.string().optional().describe("Full actor name, e.g. 'Harrison Ford'."),
      year: z.number().int().optional().describe("Release year (a show's first air year)."),
      library: z.string().optional().describe("Only search Plex libraries whose name contains this text, e.g. '4k' for the 4K libraries, 'kids', 'anime', 'sports'."),
      watched: z.enum(["unwatched", "inProgress", "watched"]).optional().describe("Only titles never played, started but not finished, or finished."),
      notWatchedInYears: z.number().positive().optional().describe("Only titles not watched for this many years (a never-watched title counts from when it was added)."),
      network: z.string().optional().describe("TV network (shows) or studio (movies), e.g. 'HBO', 'Netflix'."),
      contentRating: z.string().optional().describe("Content rating, e.g. 'TV-MA', 'PG-13', 'R'."),
      minRating: z.number().min(0).max(10).optional().describe("Audience rating of at least this (0-10)."),
      yearFrom: z.number().int().optional().describe("Released in or after this year (a decade: 1990 to 1999)."),
      yearTo: z.number().int().optional().describe("Released in or before this year."),
      addedWithinDays: z.number().positive().optional().describe("Added to Plex within this many days."),
      sort: z.enum(["title", "recentlyAdded", "lastWatched", "leastRecentlyWatched"]).optional().describe("Order the results (default title)."),
      limit: z.number().int().min(1).max(500).optional().describe("Maximum results to return (default 25, max 500)."),
      offset: z.number().int().min(0).optional().describe("Matches to skip, to fetch the next page of a long result."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Part of the movie or show title." },
        mediaType: { type: "string", enum: ["movie", "show", "any"], description: "Search only movies, only TV shows, or both (default any)." },
        genre: { type: "string", description: "Genre name, e.g. 'Horror' or 'Science Fiction'." },
        actor: { type: "string", description: "Full actor name, e.g. 'Harrison Ford'." },
        year: { type: "integer", description: "Release year (a show's first air year)." },
        library: { type: "string", description: "Only search Plex libraries whose name contains this text, e.g. '4k' for the 4K libraries, 'kids', 'anime', 'sports'." },
        watched: { type: "string", enum: ["unwatched", "inProgress", "watched"], description: "Only titles never played, started but not finished, or finished." },
        notWatchedInYears: { type: "number", description: "Only titles not watched for this many years (a never-watched title counts from when it was added)." },
        network: { type: "string", description: "TV network (shows) or studio (movies), e.g. 'HBO', 'Netflix'." },
        contentRating: { type: "string", description: "Content rating, e.g. 'TV-MA', 'PG-13', 'R'." },
        minRating: { type: "number", description: "Audience rating of at least this (0-10)." },
        yearFrom: { type: "integer", description: "Released in or after this year (a decade: 1990 to 1999)." },
        yearTo: { type: "integer", description: "Released in or before this year." },
        addedWithinDays: { type: "number", description: "Added to Plex within this many days." },
        sort: { type: "string", enum: ["title", "recentlyAdded", "lastWatched", "leastRecentlyWatched"], description: "Order the results (default title)." },
        limit: { type: "integer", description: "Maximum results to return (default 25, max 500)." },
        offset: { type: "integer", description: "Matches to skip, to fetch the next page of a long result." },
      },
      required: [] as string[],
    },
    handler: async (args: PlexSearchArgs) => searchPlexLibrary(args),
  },
  {
    name: "get_on_deck",
    description:
      "Answers 'what should I watch next?' from Plex's On Deck ('Continue Watching'): the movies the user has partly played and, for each show they are following, the episode to watch next (or the one they are part way through), most recently active first, with how far through each one is. A movie held in HD and 4K is one entry. " +
      "Use title for 'which episode is next for <show>?' and mediaType 'show' for 'which episode is next in each show?'. IMPORTANT: On Deck is only Plex's short recent list (at most 50 items across everything), not every unfinished title, so for 'which movies did I start but not finish?', 'what haven't I finished?' or any complete list use search_plex_library with watched 'inProgress' instead. The watch state is for the Plex account the app is connected with.",
    zodSchema: {
      mediaType: z.enum(["movie", "show", "any"]).optional().describe("Only movies, only shows' next episodes, or both (default any)."),
      library: z.string().optional().describe("Only Plex libraries whose name contains this text, e.g. 'kids', '4k'."),
      title: z.string().optional().describe("Only a movie or show whose title contains this text, e.g. 'Dark Matter'."),
      limit: z.number().int().min(1).max(50).optional().describe("How many to list (default 10, max 50)."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        mediaType: { type: "string", enum: ["movie", "show", "any"], description: "Only movies, only shows' next episodes, or both (default any)." },
        library: { type: "string", description: "Only Plex libraries whose name contains this text, e.g. 'kids', '4k'." },
        title: { type: "string", description: "Only a movie or show whose title contains this text, e.g. 'Dark Matter'." },
        limit: { type: "integer", description: "How many to list (default 10, max 50)." },
      },
      required: [] as string[],
    },
    handler: async (args: OnDeckArgs) => getOnDeck(args),
  },
  {
    name: "search_episodes",
    description:
      "Finds individual TV episodes in the user's Plex library: 'the episode of <show> where ...', 'which episode is called ...', episodes that aired in a date range, a show's season premieres or finales. " +
      "IMPORTANT: Plex cannot search episode plots across the whole library. To search PLOTS (summaries) you must name the show (the show argument); the words then match the episode title and its plot. Without a show, only episode TITLES (and air dates) can be searched. When the user describes an episode by its plot and no show is known, ask which show or say only titles can be searched. " +
      "Use season and episode for a specific one, airedFrom/airedTo (YYYY-MM-DD) for 'aired in March 2026', and episodeType 'premiere' or (with a show) 'finale'. Each result shows the show, season and episode numbers, air date and watch state.",
    zodSchema: {
      show: z.string().optional().describe("A show to search inside, e.g. 'Entourage'. Required to search plots."),
      text: z.string().optional().describe("Words that must all appear in the episode title (and, with a show, its plot)."),
      season: z.number().int().min(0).optional().describe("Only this season."),
      episode: z.number().int().min(0).optional().describe("Only this episode number (needs season)."),
      airedFrom: z.string().optional().describe("Aired on or after this date, YYYY-MM-DD."),
      airedTo: z.string().optional().describe("Aired on or before this date, YYYY-MM-DD."),
      episodeType: z.enum(["premiere", "finale"]).optional().describe("Only season premieres, or season finales (needs a show)."),
      library: z.string().optional().describe("Without a show: only show libraries whose name contains this text, e.g. 'kids'."),
      limit: z.number().int().min(1).max(100).optional().describe("How many to list (default 15, max 100)."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        show: { type: "string", description: "A show to search inside, e.g. 'Entourage'. Required to search plots." },
        text: { type: "string", description: "Words that must all appear in the episode title (and, with a show, its plot)." },
        season: { type: "integer", description: "Only this season." },
        episode: { type: "integer", description: "Only this episode number (needs season)." },
        airedFrom: { type: "string", description: "Aired on or after this date, YYYY-MM-DD." },
        airedTo: { type: "string", description: "Aired on or before this date, YYYY-MM-DD." },
        episodeType: { type: "string", enum: ["premiere", "finale"], description: "Only season premieres, or season finales (needs a show)." },
        library: { type: "string", description: "Without a show: only show libraries whose name contains this text, e.g. 'kids'." },
        limit: { type: "integer", description: "How many to list (default 15, max 100)." },
      },
      required: [] as string[],
    },
    handler: async (args: EpisodeSearchArgs) => searchEpisodes(args),
  },
  {
    name: "resolve_actor_filmography",
    description:
      "Resolves an actor's name to their official TMDb filmography (movies and TV shows), filtering out talk shows, news, self-appearances, and uncredited roles. When Plex is configured, marks which of those titles the user already has in their Plex library and which they don't. Use this to answer which of an actor's movies or shows the user is missing. " +
      "Pass mediaType 'movie' when the user asks about movies/films, 'show' for TV/series, and leave it out (any) when the question is about the actor's work in general; keep the same mediaType on follow-ups.",
    zodSchema: {
      actorName: z.string().describe("The exact name of the actor (e.g., 'Harrison Ford')."),
      mediaType: z.enum(["movie", "show", "any"]).optional().describe("Only movies, only TV shows, or both (default any)."),
      limit: z.number().int().min(1).max(100).optional().describe("How many titles to list, newest first (default 15)."),
      yearFrom: z.number().int().optional().describe("Only titles released in or after this year."),
      yearTo: z.number().int().optional().describe("Only titles released in or before this year."),
      show: z.enum(["all", "owned", "missing"]).optional().describe("Only titles the user has in Plex ('owned'), only those they don't ('missing'), or both (default)."),
      library: z.string().optional().describe("Judge ownership only against Plex libraries whose name contains this text, e.g. '4k': 'owned' then means held in a 4K library and 'missing' means not held in any."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        actorName: { type: "string", description: "The exact name of the actor (e.g., 'Harrison Ford')." },
        mediaType: { type: "string", enum: ["movie", "show", "any"], description: "Only movies, only TV shows, or both (default any)." },
        limit: { type: "integer", description: "How many titles to list, newest first (default 15)." },
        yearFrom: { type: "integer", description: "Only titles released in or after this year." },
        yearTo: { type: "integer", description: "Only titles released in or before this year." },
        show: { type: "string", enum: ["all", "owned", "missing"], description: "Only titles the user has in Plex ('owned'), only those they don't ('missing'), or both (default)." },
        library: { type: "string", description: "Judge ownership only against Plex libraries whose name contains this text, e.g. '4k': 'owned' then means held in a 4K library and 'missing' means not held in any." },
      },
      required: ["actorName"],
    },
    handler: async ({ actorName, ...options }: { actorName: string } & FilmographyOptions) => resolveActorFilmography(actorName, options),
  },
  {
    name: "check_series_completeness",
    description:
      "Answers 'do I have every episode of <show>?' from Sonarr's episode list: how many aired episodes are downloaded, which seasons and episodes are missing, what has not aired yet, and whether Sonarr is monitoring the show (so will fetch the rest). " +
      "Use this for one specific TV show; use find_series_gaps to see which shows have gaps. It does not check what Plex has scanned.",
    zodSchema: {
      title: z.string().describe("The show's title, e.g. 'Breaking Bad'."),
      year: z.number().int().optional().describe("First air year, only needed to tell same-named shows apart."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "The show's title, e.g. 'Breaking Bad'." },
        year: { type: "integer", description: "First air year, only needed to tell same-named shows apart." },
      },
      required: ["title"],
    },
    handler: async ({ title, year }: { title: string; year?: number }) => checkSeriesCompleteness(title, year),
  },
  {
    name: "find_series_gaps",
    description:
      "Lists the TV shows in Sonarr that are missing aired episodes, most missing first, with how many are downloaded, whether Sonarr is monitoring each show, and whether it is actively looking for the rest. " +
      "Use it for 'which of my shows have gaps?', 'what am I missing?' or 'which shows are only missing a few episodes?'. Use monitored 'searching' for 'what is Sonarr still looking for?'. Express any narrowing as a filter (monitored, minMissing, maxMissing, hideEmpty) rather than filtering the result yourself, because the table shown to the user is exactly the rows returned. " +
      "Most gaps are in shows that are deliberately not monitored or only partly kept; 'hideEmpty' drops shows with nothing downloaded and 'maxMissing' finds near-complete ones. For one show use check_series_completeness.",
    zodSchema: {
      monitored: z.enum(["any", "monitored", "unmonitored", "searching"]).optional().describe("Only shows Sonarr is monitoring, only ones it is not, only ones it is actively searching missing episodes for ('searching'), or all (default any)."),
      minMissing: z.number().int().min(1).optional().describe("Only shows missing at least this many episodes."),
      maxMissing: z.number().int().min(1).optional().describe("Only shows missing at most this many episodes, e.g. 5 for nearly complete shows."),
      hideEmpty: z.boolean().optional().describe("Skip shows with no episodes downloaded at all."),
      limit: z.number().int().min(1).max(200).optional().describe("How many shows to list (default 15, max 200)."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        monitored: { type: "string", enum: ["any", "monitored", "unmonitored", "searching"], description: "Only shows Sonarr is monitoring, only ones it is not, only ones it is actively searching missing episodes for ('searching'), or all (default any)." },
        minMissing: { type: "integer", description: "Only shows missing at least this many episodes." },
        maxMissing: { type: "integer", description: "Only shows missing at most this many episodes, e.g. 5 for nearly complete shows." },
        hideEmpty: { type: "boolean", description: "Skip shows with no episodes downloaded at all." },
        limit: { type: "integer", description: "How many shows to list (default 15, max 200)." },
      },
      required: [] as string[],
    },
    handler: async (options: SeriesGapOptions) => findSeriesGaps(options),
  },
  {
    name: "check_series_status",
    description:
      "The TV counterpart of check_movie_status: what Sonarr knows about one show - whether it is monitored, its quality profile and location, when the next episode airs, when something was last downloaded, what is in the download queue, and how many aired episodes are downloaded. " +
      "Use it for 'is <show> monitored?', 'what quality is <show>?', 'when does <show> come back?'. For which episodes are missing use check_series_completeness; for why one is missing use diagnose_missing_episodes.",
    zodSchema: {
      title: z.string().describe("The show's title, e.g. 'Severance'."),
      year: z.number().int().optional().describe("First air year, only needed to tell same-named shows apart."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "The show's title, e.g. 'Severance'." },
        year: { type: "integer", description: "First air year, only needed to tell same-named shows apart." },
      },
      required: ["title"],
    },
    handler: async ({ title, year }: { title: string; year?: number }) => checkSeriesStatus(title, year),
  },
  {
    name: "diagnose_missing_episodes",
    description:
      "Explains WHY aired episodes of a show have no file, the TV counterpart of diagnose_missing_media: from Sonarr's history and download queue it says, per group of episodes, whether they were never grabbed, were grabbed but never imported, had a download fail (and why), had their file removed, are stuck in the queue, or are simply not monitored so Sonarr never looks for them. Read-only: it changes nothing. " +
      "Give season (and episode) to look at just those; without them it groups every missing episode of the show. Use check_series_completeness first to see which episodes are missing.",
    zodSchema: {
      title: z.string().describe("The show's title, e.g. 'Bluey'."),
      season: z.number().int().min(0).optional().describe("Only this season."),
      episode: z.number().int().min(0).optional().describe("Only this episode number (needs season)."),
      year: z.number().int().optional().describe("First air year, only needed to tell same-named shows apart."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "The show's title, e.g. 'Bluey'." },
        season: { type: "integer", description: "Only this season." },
        episode: { type: "integer", description: "Only this episode number (needs season)." },
        year: { type: "integer", description: "First air year, only needed to tell same-named shows apart." },
      },
      required: ["title"],
    },
    handler: async ({ title, ...options }: { title: string } & DiagnoseOptions) => diagnoseMissingEpisodes(title, options),
  },
  {
    name: "get_upcoming_episodes",
    description:
      "What TV episodes are coming, from Sonarr's calendar. With no title it answers 'what's on this week?': every episode airing in the next few days (default 7, up to 60) from the shows Sonarr monitors, by day, with season premieres and finales flagged and episodes already downloaded marked. " +
      "With a title it answers 'when does <show> come back?': that show's next episodes, or that none is scheduled yet (or that it has ended). Only shows Sonarr monitors are listed by default and the number left out is reported; use monitored 'unmonitored' when the user asks about shows they do not monitor, or 'any' for everything (express that as the filter, because the table shown to the user is exactly the rows returned). Dates are the network's own air dates.",
    zodSchema: {
      days: z.number().int().min(1).max(60).optional().describe("How many days ahead to list when no title is given (default 7, max 60)."),
      title: z.string().optional().describe("A show to ask about instead, e.g. 'Severance': its next episodes or that none is scheduled."),
      year: z.number().int().optional().describe("First air year, only needed to tell same-named shows apart."),
      monitored: z.enum(["monitored", "unmonitored", "any"]).optional().describe("Only shows Sonarr monitors (default), only ones it does not monitor, or all."),
    },
    inputSchema: {
      type: "object" as const,
      properties: {
        days: { type: "integer", description: "How many days ahead to list when no title is given (default 7, max 60)." },
        title: { type: "string", description: "A show to ask about instead, e.g. 'Severance': its next episodes or that none is scheduled." },
        year: { type: "integer", description: "First air year, only needed to tell same-named shows apart." },
        monitored: { type: "string", enum: ["monitored", "unmonitored", "any"], description: "Only shows Sonarr monitors (default), only ones it does not monitor, or all." },
      },
      required: [] as string[],
    },
    handler: async (options: UpcomingOptions) => getUpcomingEpisodes(options),
  },
];

// Movie lookup and missing-media diagnostics.
export function registerMovieTools() {
  for (const tool of movieTools) {
    server.tool(tool.name, tool.description, tool.zodSchema, tool.handler);
  }
}
