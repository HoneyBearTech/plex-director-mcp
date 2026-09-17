import { Router } from "express";
import { radarrClient, tmdbClient, sabnzbdClient } from "../../clients.js";
import { getErrorMessage } from "../../util.js";

export const moviesRouter = Router();

moviesRouter.get("/status", async (req, res) => {
  const title = String(req.query.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const lookupResponse = await radarrClient.get(`/api/v3/movie/lookup?term=${encodeURIComponent(title)}`);
    const lookupMovies = lookupResponse.data as Array<any>;

    if (!lookupMovies || lookupMovies.length === 0) {
      res.json({ found: false });
      return;
    }

    const libraryResponse = await radarrClient.get("/api/v3/movie");
    const libraryMovies = libraryResponse.data as Array<any>;
    const lookupMatch = lookupMovies[0];
    const normalizedTitle = String(lookupMatch.title || title).trim().toLowerCase();
    const primaryMatch = libraryMovies.find(
      (movie: any) =>
        (lookupMatch.tmdbId && movie.tmdbId === lookupMatch.tmdbId) ||
        (String(movie.title || "").trim().toLowerCase() === normalizedTitle && movie.year === lookupMatch.year)
    );

    if (!primaryMatch) {
      res.json({ found: false, inRadarrDatabase: true });
      return;
    }

    let posterUrl: string | undefined = primaryMatch.images?.find((image: any) => image.coverType === "poster")?.remoteUrl;
    if (!posterUrl && primaryMatch.tmdbId) {
      const tmdbResponse = await tmdbClient.get(`/movie/${primaryMatch.tmdbId}`);
      const posterPath = tmdbResponse.data?.poster_path;
      if (posterPath) {
        posterUrl = `https://image.tmdb.org/t/p/w500${posterPath}`;
      }
    }

    res.json({
      found: true,
      title: primaryMatch.title,
      year: primaryMatch.year,
      monitored: primaryMatch.monitored,
      status: primaryMatch.status,
      hasFile: primaryMatch.hasFile,
      path: primaryMatch.path ?? null,
      overview: primaryMatch.overview ?? null,
      posterUrl: posterUrl ?? null,
    });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});

moviesRouter.get("/diagnose", async (req, res) => {
  const title = String(req.query.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const steps: Array<{ step: string; status: "ok" | "warn" | "error" | "info"; detail: string }> = [];

  try {
    const radarrSearch = await radarrClient.get(`/api/v3/movie/lookup?term=${encodeURIComponent(title)}`);
    const movieMatches = radarrSearch.data as Array<any>;

    if (!movieMatches || movieMatches.length === 0) {
      steps.push({ step: "Radarr lookup", status: "error", detail: `"${title}" is not in your Radarr database.` });
      res.json({ steps });
      return;
    }

    const movie = movieMatches[0];
    steps.push({ step: "Radarr lookup", status: "ok", detail: `Found ${movie.title} (${movie.year})` });

    if (!movie.monitored) {
      steps.push({ step: "Monitoring", status: "warn", detail: "Not marked as monitored - it will never auto-search for releases." });
    } else {
      steps.push({ step: "Monitoring", status: "ok", detail: "Monitored." });
    }

    if (movie.hasFile) {
      steps.push({ step: "File check", status: "ok", detail: `File already exists at ${movie.path}` });
      res.json({ steps });
      return;
    }

    const sabQueue = await sabnzbdClient.get("", { params: { mode: "queue" } });
    const activeDownloads = sabQueue.data?.queue?.slots || [];
    const activeMatch = activeDownloads.find(
      (slot: any) => typeof slot?.filename === "string" && slot.filename.toLowerCase().includes(title.toLowerCase())
    );

    if (activeMatch) {
      steps.push({
        step: "Download queue",
        status: "info",
        detail: `In queue: ${activeMatch.filename} (${activeMatch.status}, ${activeMatch.percentage}%, ETA ${activeMatch.timeleft})`,
      });
      res.json({ steps });
      return;
    }

    if (movie.id) {
      const historyResponse = await radarrClient.get(`/api/v3/history?movieId=${movie.id}`);
      const historyItems = historyResponse.data?.records || [];
      const failedItems = historyItems.filter((h: any) => h.eventType === "downloadFailed");
      if (failedItems.length > 0) {
        steps.push({ step: "History", status: "error", detail: `${failedItems.length} failed release attempts found.` });
      } else {
        steps.push({ step: "History", status: "warn", detail: "No grab or failure history - indexers may lack a matching release." });
      }
    } else {
      steps.push({ step: "History", status: "warn", detail: "No local ID yet - RSS sync hasn't matched a release." });
    }

    res.json({ steps });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});

moviesRouter.get("/search", async (req, res) => {
  const query = String(req.query.query ?? "").trim();
  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const response = await tmdbClient.get(`/search/movie?query=${encodeURIComponent(query)}`);
    const results = (response.data?.results || []).slice(0, 10).map((movie: any) => ({
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date ? movie.release_date.split("-")[0] : null,
      overview: movie.overview ?? null,
      posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null,
    }));
    res.json({ results });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
