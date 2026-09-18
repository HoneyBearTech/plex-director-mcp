import { useEffect, useState } from "react";

interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

// Simple client-side polling - good enough for a homelab dashboard without
// pulling in WebSocket/SSE infrastructure for a handful of low-traffic pages.
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 15_000): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const data = await fetcher();
        if (!cancelled) {
          setState({ data, error: null, loading: false });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ data: prev.data, error: error instanceof Error ? error.message : "Unknown error", loading: false }));
        }
      }
    }

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // fetcher deliberately excluded - callers pass a fresh closure each
    // render, and including it would restart polling on every render.
  }, [intervalMs]);

  return state;
}
