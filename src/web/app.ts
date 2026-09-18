import express from "express";
import path from "node:path";
import { projectRoot } from "../env.js";
import { statusRouter } from "./routes/status.js";
import { nodesRouter } from "./routes/nodes.js";
import { queuesRouter } from "./routes/queues.js";
import { settingsRouter } from "./routes/settings.js";
import { chatRouter } from "./routes/chat.js";

export function createWebApp() {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/status", statusRouter);
  app.use("/api/nodes", nodesRouter);
  app.use("/api/queues", queuesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/chat", chatRouter);

  const staticDir = path.join(projectRoot, "web", "dist");
  app.use(express.static(staticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return app;
}
