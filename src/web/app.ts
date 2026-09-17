import express from "express";
import path from "node:path";
import { projectRoot } from "../env.js";
import { moviesRouter } from "./routes/movies.js";
import { statusRouter } from "./routes/status.js";
import { nodesRouter } from "./routes/nodes.js";
import { queuesRouter } from "./routes/queues.js";

export function createWebApp() {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/movies", moviesRouter);
  app.use("/api/status", statusRouter);
  app.use("/api/nodes", nodesRouter);
  app.use("/api/queues", queuesRouter);

  const staticDir = path.join(projectRoot, "web", "dist");
  app.use(express.static(staticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return app;
}
