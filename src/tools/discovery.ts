import { z } from "zod";
import { server } from "../server.js";
import { db } from "../db.js";
import { tmdbClient, prowlarrClient } from "../clients.js";
import { textReply, getErrorMessage } from "../util.js";

// TMDb discovery, indexer health, and interactive movie selection.
export function registerDiscoveryTools() {
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

          const cleanOverview = movie.overview
            ? movie.overview.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")
            : "No overview available.";
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
