import { z } from "zod";
import { server } from "../server.js";
import { db } from "../db.js";
import { tmdbClient, radarrClient } from "../clients.js";
import { textReply, getErrorMessage, escapeTableCell } from "../util.js";
import { isConfigured } from "../settings.js";
import { getOwnedTmdbIndex, type MovieRow } from "./plex.js";
import { getIndexerHealth } from "../indexers.js";

const DEFAULT_FILMOGRAPHY_LIMIT = 15;

// Registered through movieTools (src/tools/movies.ts) so the MCP client and the
// web chat share it. TMDb knows every film an actor was in; Plex knows which of
// them the user actually has, so when Plex is configured each title is marked.
export interface FilmographyOptions {
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
  // Only meaningful when Plex is configured; otherwise everything is "all".
  show?: "all" | "owned" | "missing";
  // Judge ownership only against Plex libraries whose name contains this text
  // (case-insensitive), e.g. "4k": "owned" then means held in a matching
  // library and "missing" means not held in any of them.
  library?: string;
}

export async function resolveActorFilmography(actorName: string, options: FilmographyOptions = {}) {
  const { limit = DEFAULT_FILMOGRAPHY_LIMIT, yearFrom, yearTo, show = "all", library } = options;
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

    let owned: Map<string, string[]> | null = null;
    let plexNote = "";
    if (isConfigured("PLEX")) {
      try {
        owned = await getOwnedTmdbIndex();

        if (library) {
          const wanted = library.trim().toLowerCase();
          const libraryNames = [...new Set([...owned.values()].flat())];
          if (!libraryNames.some((name) => name.toLowerCase().includes(wanted))) {
            return textReply(`No Plex movie library matching "${library}". Movie libraries with titles: ${libraryNames.join(", ")}.`, true);
          }
          owned = new Map(
            [...owned]
              .map(([id, names]): [string, string[]] => [id, names.filter((name) => name.toLowerCase().includes(wanted))])
              .filter(([, names]) => names.length > 0)
          );
        }
      } catch (error: unknown) {
        plexNote = `(Couldn't check Plex ownership: ${getErrorMessage(error)})\n`;
      }
    }

    let output = `🎬 Resolved: ${person.name} (TMDb ID: ${person.id})\n`;
    output += `Filtered filmography to ${cleanFilmography.length} structural movie targets (removed docs/uncredited/self):\n`;
    if (owned) {
      const ownedCount = cleanFilmography.filter((movie: any) => owned.has(String(movie.id))).length;
      output += library
        ? `In your Plex libraries matching "${library}": ${ownedCount} of ${cleanFilmography.length}.\n`
        : `In your Plex library: ${ownedCount} of ${cleanFilmography.length}.\n`;
    }
    output += plexNote;

    // Filters are applied here (not left to the model) so the table the web
    // UI shows is exactly the set that was asked about.
    const releaseYear = (movie: any): number | null =>
      movie.release_date ? Number(String(movie.release_date).split("-")[0]) : null;
    const matching = cleanFilmography.filter((movie: any) => {
      const year = releaseYear(movie);
      if (yearFrom !== undefined && (year === null || year < yearFrom)) return false;
      if (yearTo !== undefined && (year === null || year > yearTo)) return false;
      if (owned && show === "owned" && !owned.has(String(movie.id))) return false;
      if (owned && show === "missing" && owned.has(String(movie.id))) return false;
      return true;
    });
    if (matching.length !== cleanFilmography.length) {
      const filters = [
        yearFrom !== undefined || yearTo !== undefined ? `released ${yearFrom ?? "any"}-${yearTo ?? "any"}` : null,
        owned && show !== "all" ? (show === "owned" ? "in Plex" : "not in Plex") : null,
      ].filter(Boolean);
      output += `Showing ${matching.length} titles (${filters.join(", ")}).\n`;
    }
    output += "\n";

    matching.slice(0, limit).forEach((movie: any) => {
      const libraries = owned?.get(String(movie.id));
      const status = owned ? (libraries ? ` - ✅ In Plex (${libraries.join(", ")})` : " - ❌ Not in Plex") : "";
      output += `  ▪ ${movie.title} (${movie.release_date ? movie.release_date.split("-")[0] : "N/A"}) - As: ${movie.character || "Unknown"}${status}\n`;
    });

    if (matching.length > limit) {
      output += `  ...and ${matching.length - limit} additional titles.`;
    }

    // Same titles as the text list, for the web UI's results table. TMDb
    // posters are public, so they can be loaded directly (unlike Plex's).
    const movies: MovieRow[] = matching.slice(0, limit).map((movie: any) => ({
      title: String(movie.title),
      year: movie.release_date ? Number(movie.release_date.split("-")[0]) : null,
      posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w154${movie.poster_path}` : null,
      libraries: owned ? (owned.get(String(movie.id)) ?? []) : null,
      genres: [],
      rating: movie.vote_average ? Number(movie.vote_average) : null,
      detail: movie.character ? `As ${movie.character}` : null,
    }));

    return { ...textReply(output), structuredContent: { movies } };
  } catch (error: unknown) {
    return textReply(`TMDb Resolution failed: ${getErrorMessage(error)}`, true);
  }
}

// Used when confirm_selected_choices isn't told which quality profile to use.
// Matches the profile most of the library already uses; looked up by name so
// it survives Radarr profile IDs changing.
const DEFAULT_RADARR_QUALITY_PROFILE = "Remux + WEB 1080p";

// Radarr validation failures come back as an array of { errorMessage }, which
// getErrorMessage() (built for a single { message }) would flatten to "Bad Request".
function radarrErrorMessage(error: unknown): string {
  const data = (error as any)?.response?.data;
  if (Array.isArray(data) && data.length > 0) {
    return data.map((d: any) => d.errorMessage || d.message).filter(Boolean).join("; ");
  }
  return getErrorMessage(error);
}

// TMDb discovery, indexer health, and interactive movie selection.
export function registerDiscoveryTools() {
  server.tool(
    "check_indexer_health",
    "Audits all Usenet indexers and torrent trackers configured in Prowlarr to flag connection failures or bans, and reports Prowlarr's own system health warnings.",
    {},
    async () => {
      try {
        const { indexers, warnings } = await getIndexerHealth();
        const problems = indexers.filter((i) => i.state === "backing-off" || i.state === "warning");
        const disabled = indexers.filter((i) => i.state === "disabled");

        let report = "";
        if (problems.length === 0) {
          report += `✅ All ${indexers.length - disabled.length} enabled indexers and trackers reporting healthy inside Prowlarr. Zero connection drops or backoffs detected.\n`;
        } else {
          report += "⚠️ Prowlarr Indexer Health Warning:\n";
          report += `Detected ${problems.length} indexer operational anomalies across your tracker network:\n\n`;
          for (const indexer of problems) {
            const failedAt = indexer.mostRecentFailure ? new Date(indexer.mostRecentFailure).toLocaleString() : "unknown";
            report += `▪ Indexer: ${indexer.name} (${indexer.protocol})\n`;
            report += `  ↳ Most Recent Failure: ${failedAt}\n`;
            report += indexer.state === "backing-off"
              ? `  ↳ Backing off until: ${new Date(indexer.disabledTill as string).toLocaleString()} (escalation level ${indexer.escalationLevel})\n\n`
              : `  ↳ Not currently backed off, but has recent failures (escalation level ${indexer.escalationLevel})\n\n`;
          }
        }

        if (disabled.length > 0) {
          report += `Disabled in Prowlarr: ${disabled.map((i) => i.name).join(", ")}\n`;
        }
        if (warnings.length > 0) {
          report += `\nProwlarr system warnings:\n${warnings.map((w) => `  ▪ [${w.type}] ${w.message}`).join("\n")}\n`;
        }

        return textReply(report);
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
          const poster = movie.poster_path ? `![${movie.title}](https://image.tmdb.org/t/p/w500${movie.poster_path})` : "*No poster*";

          insertStmt.run(choiceId, movie.id, movie.title, year);

          const cleanOverview = movie.overview
            ? escapeTableCell(movie.overview)
            : "No overview available.";
          const truncatedOverview = cleanOverview.length > 180 ? `${cleanOverview.slice(0, 180)}...` : cleanOverview;

          markdownOutput += `| **[ Choice ${choiceId} ]** | ${poster} | **${movie.title} (${year})**  <br> *TMDb ID: ${movie.id}* <br><br> ${truncatedOverview} |\n`;
        });

        return textReply(markdownOutput);
      } catch (error: unknown) {
        return textReply(`Failed generating selection matrix: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "confirm_selected_choices",
    "Adds the user's numbered choices from the last search_and_select_movies grid to Radarr as monitored movies and starts a download search for each. Movies already in Radarr are reported, not added twice. Uses the 'Remux + WEB 1080p' quality profile and Radarr's first root folder unless told otherwise.",
    {
      chosenIndexes: z.array(z.number()).describe("An array of chosen numbers selected by the user (e.g., [1, 3])."),
      qualityProfile: z.string().optional().describe("Radarr quality profile name to use instead of the default."),
      rootFolder: z.string().optional().describe("Radarr root folder path to add to instead of the first one (e.g. '/media/movieskids')."),
    },
    async ({ chosenIndexes, qualityProfile, rootFolder }) => {
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

        const profiles: Array<{ id: number; name: string }> = (await radarrClient.get("/api/v3/qualityprofile")).data ?? [];
        const wantedProfile = (qualityProfile ?? DEFAULT_RADARR_QUALITY_PROFILE).trim().toLowerCase();
        const profile = profiles.find((p) => p.name.toLowerCase() === wantedProfile);
        if (!profile) {
          return textReply(
            `❌ No Radarr quality profile named "${qualityProfile ?? DEFAULT_RADARR_QUALITY_PROFILE}". Available: ${profiles.map((p) => p.name).join(", ")}.`,
            true
          );
        }

        const rootFolders: Array<{ path: string }> = (await radarrClient.get("/api/v3/rootfolder")).data ?? [];
        const folder = rootFolder
          ? rootFolders.find((f) => f.path.replace(/\/+$/, "") === rootFolder.replace(/\/+$/, ""))
          : rootFolders[0];
        if (!folder) {
          return textReply(
            rootFolder
              ? `❌ No Radarr root folder "${rootFolder}". Available: ${rootFolders.map((f) => f.path).join(", ")}.`
              : "❌ Radarr has no root folders configured.",
            true
          );
        }

        let report = `🚀 **Adding selected movies to Radarr** (profile: ${profile.name}, folder: ${folder.path})\n`;
        for (const selection of matchedSelections) {
          const label = `**Choice ${selection.selection_index}**: ${selection.title} (${selection.year}) [TMDb: ${selection.tmdb_id}]`;
          try {
            const existing = (await radarrClient.get("/api/v3/movie", { params: { tmdbId: selection.tmdb_id } })).data ?? [];
            if (existing.length > 0) {
              const state = existing[0].hasFile ? "already downloaded" : "monitored but not downloaded yet";
              report += `  ⏭️ ${label} - already in Radarr (${state}); not added again.\n`;
              continue;
            }

            // Radarr wants the full resolved movie record, not just an id, so start
            // from its own TMDb lookup and layer our choices on top.
            const lookup = (await radarrClient.get("/api/v3/movie/lookup/tmdb", { params: { tmdbId: selection.tmdb_id } })).data;
            await radarrClient.post("/api/v3/movie", {
              ...lookup,
              qualityProfileId: profile.id,
              rootFolderPath: folder.path,
              monitored: true,
              minimumAvailability: "released",
              addOptions: { searchForMovie: true },
            });
            report += `  ✅ ${label} - added and download search started.\n`;
          } catch (error: unknown) {
            report += `  ❌ ${label} - failed: ${radarrErrorMessage(error)}\n`;
          }
        }

        return textReply(report);
      } catch (error: unknown) {
        return textReply(`Execution failed during confirmation: ${radarrErrorMessage(error)}`, true);
      }
    }
  );
}
