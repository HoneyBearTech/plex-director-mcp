import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { projectRoot } from "../env.js";
import { statusRouter } from "./routes/status.js";
import { nodesRouter } from "./routes/nodes.js";
import { queuesRouter } from "./routes/queues.js";
import { settingsRouter } from "./routes/settings.js";
import { chatRouter } from "./routes/chat.js";
import { plexRouter } from "./routes/plex.js";
import { indexersRouter } from "./routes/indexers.js";
import { jobsRouter } from "./routes/jobs.js";

export function createWebApp() {
  const app = express();
  app.use(express.json());
  // Generous enough for normal dashboard polling (several endpoints polled
  // every 10-15s) while bounding repeated disk reads from the static/SPA
  // handlers below against abuse - flagged by CodeQL as unrate-limited
  // file-system access otherwise.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/status", statusRouter);
  app.use("/api/nodes", nodesRouter);
  app.use("/api/queues", queuesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/plex", plexRouter);
  app.use("/api/indexers", indexersRouter);
  app.use("/api/jobs", jobsRouter);

  // Anything under /api that didn't match a router above is a missing or
  // mistyped endpoint - without this, it falls through to the SPA catch-all
  // below and comes back as a 200 HTML page instead of a clear 404.
  app.use("/api/{*splat}", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const staticDir = path.join(projectRoot, "web", "dist");
  app.use(express.static(staticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return app;
}
