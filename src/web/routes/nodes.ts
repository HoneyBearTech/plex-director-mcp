import { Router } from "express";
import { getConfiguredHosts, probeAllHosts, trustNewHostKey } from "../../cluster.js";
import { isAuthEnabled } from "../auth.js";

export const nodesRouter = Router();

// Real per-host SSH telemetry, one connection per host per poll (see
// src/cluster.ts, which the cluster MCP tools share).
nodesRouter.get("/health", async (_req, res) => {
  const hosts = getConfiguredHosts();
  res.json({ hosts: hosts.length === 0 ? [] : await probeAllHosts(hosts) });
});

// For a host whose SSH key legitimately changed: forget the remembered key so
// the next probe trusts what the host now presents. Whoever does this decides
// which machine counts as that host, so with no WEB_PASSWORD (anyone on the
// network can use the dashboard) it is left to the trust_new_host_key MCP tool,
// whose client asks the user first.
nodesRouter.post("/trust-new-key", (req, res) => {
  if (!isAuthEnabled()) {
    res.status(403).json({ error: TRUST_NEEDS_PASSWORD });
    return;
  }
  const host = typeof req.body?.host === "string" ? req.body.host : "";
  const result = trustNewHostKey(host);
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json(result);
});

export const TRUST_NEEDS_PASSWORD =
  "Trusting a new host key from the dashboard needs a login: set WEB_PASSWORD. Without one, use the trust_new_host_key tool in Claude Desktop.";
