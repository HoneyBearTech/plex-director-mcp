import { Router } from "express";
import { getConfiguredHosts, probeAllHosts } from "../../cluster.js";

export const nodesRouter = Router();

// Real per-host SSH telemetry, one connection per host per poll (see
// src/cluster.ts, which the cluster MCP tools share).
nodesRouter.get("/health", async (_req, res) => {
  const hosts = getConfiguredHosts();
  res.json({ hosts: hosts.length === 0 ? [] : await probeAllHosts(hosts) });
});
