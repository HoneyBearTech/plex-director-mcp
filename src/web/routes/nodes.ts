import { Router } from "express";
import { getConfiguredHosts, probeAllHosts } from "../../cluster.js";
import { forgetHostKey } from "../../hostKeys.js";

export const nodesRouter = Router();

// Real per-host SSH telemetry, one connection per host per poll (see
// src/cluster.ts, which the cluster MCP tools share).
nodesRouter.get("/health", async (_req, res) => {
  const hosts = getConfiguredHosts();
  res.json({ hosts: hosts.length === 0 ? [] : await probeAllHosts(hosts) });
});

// For a host whose SSH key legitimately changed (rebuilt, reinstalled): forget
// the remembered key so the next probe trusts what the host now presents.
// Only configured hosts can be named, so this can't be used to wipe arbitrary rows.
nodesRouter.post("/trust-new-key", (req, res) => {
  const host = typeof req.body?.host === "string" ? req.body.host : "";
  if (!getConfiguredHosts().includes(host)) {
    res.status(404).json({ error: "That host is not in the configured host list." });
    return;
  }
  res.json({ ok: true, hadRememberedKey: forgetHostKey(host) });
});
