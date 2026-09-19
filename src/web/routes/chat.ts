import { Router } from "express";
import { askMovieAssistant, type ChatTurn } from "../chat.js";
import { getErrorMessage } from "../../util.js";
import type { MovieRow } from "../../tools/plex.js";

export const chatRouter = Router();

// Keep only the fields the history summary uses, with the right types - a
// malformed row from the browser must not be able to break the request.
function sanitizeMovies(raw: unknown): MovieRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && typeof (row as any).title === "string")
    .map((row) => ({
      title: row.title as string,
      year: typeof row.year === "number" ? row.year : null,
      posterUrl: null,
      libraries: Array.isArray(row.libraries) ? row.libraries.filter((l): l is string => typeof l === "string") : null,
      genres: [],
      rating: null,
      detail: null,
    }));
}

// Anything the browser sends back as history is untrusted; keep only
// well-formed { role, text, movies? } entries. Size limits are applied in
// buildHistoryMessages().
function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((turn): turn is Record<string, unknown> => typeof turn === "object" && turn !== null)
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string")
    .map((turn): ChatTurn => {
      const movies = sanitizeMovies(turn.movies);
      return {
        role: turn.role as "user" | "assistant",
        text: turn.text as string,
        ...(movies.length > 0 ? { movies } : {}),
      };
    });
}

chatRouter.post("/movies", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  try {
    const answer = await askMovieAssistant(question, parseHistory(req.body?.history));
    res.json(answer);
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
