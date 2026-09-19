import { prowlarrClient } from "./clients.js";

// Prowlarr's view of indexer health, shared by the check_indexer_health MCP
// tool and the dashboard's Indexers page.
//
// /api/v1/indexer lists every configured indexer; /api/v1/indexerstatus only
// has an entry for indexers that have failed recently (so "no entries" means
// "all healthy"), with disabledTill set while Prowlarr is backing off from one.

export type IndexerState = "healthy" | "warning" | "backing-off" | "disabled";

export interface IndexerRow {
  id: number;
  name: string;
  protocol: string;
  priority: number;
  enabled: boolean;
  state: IndexerState;
  mostRecentFailure: string | null;
  disabledTill: string | null;
  escalationLevel: number;
}

export interface ProwlarrWarning {
  type: string;
  source: string;
  message: string;
}

export interface IndexerHealth {
  indexers: IndexerRow[];
  // Prowlarr's own system health checks (e.g. "Applications unavailable...").
  warnings: ProwlarrWarning[];
}

const STATE_ORDER: Record<IndexerState, number> = { "backing-off": 0, warning: 1, disabled: 2, healthy: 3 };

export async function getIndexerHealth(): Promise<IndexerHealth> {
  const [configs, statuses, health] = await Promise.all([
    prowlarrClient.get("/api/v1/indexer"),
    prowlarrClient.get("/api/v1/indexerstatus"),
    prowlarrClient.get("/api/v1/health"),
  ]);

  const statusByIndexer = new Map<number, any>();
  for (const status of (statuses.data ?? []) as any[]) statusByIndexer.set(status.indexerId, status);

  const now = Date.now();
  const indexers: IndexerRow[] = ((configs.data ?? []) as any[]).map((config) => {
    const status = statusByIndexer.get(config.id);
    const disabledTill: string | null = status?.disabledTill ?? null;
    const isBackingOff = disabledTill !== null && new Date(disabledTill).getTime() > now;

    let state: IndexerState = "healthy";
    if (!config.enable) state = "disabled";
    else if (isBackingOff) state = "backing-off";
    else if (status) state = "warning";

    return {
      id: config.id,
      name: String(config.name),
      protocol: String(config.protocol),
      priority: Number(config.priority),
      enabled: Boolean(config.enable),
      state,
      mostRecentFailure: status?.mostRecentFailure ?? null,
      disabledTill: isBackingOff ? disabledTill : null,
      escalationLevel: Number(status?.escalationLevel ?? 0),
    };
  });

  indexers.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));

  const warnings: ProwlarrWarning[] = ((health.data ?? []) as any[]).map((h) => ({
    type: String(h.type),
    source: String(h.source),
    message: String(h.message),
  }));

  return { indexers, warnings };
}
