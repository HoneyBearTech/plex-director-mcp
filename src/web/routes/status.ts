import { Router } from "express";
import { tautulliClient } from "../../clients.js";
import { getErrorMessage } from "../../util.js";

export const statusRouter = Router();

statusRouter.get("/activity", async (_req, res) => {
  try {
    const response = await tautulliClient.get("", { params: { cmd: "get_activity" } });
    const data = response.data?.response?.data;

    res.json({
      streamCount: Number(data?.stream_count ?? 0),
      transcodeCount: Number(data?.stream_count_transcode ?? 0),
      directPlayCount: Number(data?.stream_count_direct_play ?? 0),
      sessions: (data?.sessions ?? []).map((session: any) => ({
        user: session.user,
        title: session.title,
        year: session.year ?? null,
        resolution: session.video_resolution,
        container: session.stream_container,
        transcoding: session.transcode_decision === "transcode",
        progress: Number(session.progress ?? 0),
      })),
    });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});

statusRouter.get("/library-analytics", async (_req, res) => {
  try {
    const response = await tautulliClient.get("", { params: { cmd: "get_home_stats" } });
    const stats = response.data?.response?.data || [];

    res.json({
      categories: stats.map((category: any) => ({
        title: category.stat_title || category.stat_id || "Watch statistics",
        rows: (category.rows || []).slice(0, 5).map((item: any) => ({
          label:
            item.friendly_name ||
            item.user ||
            item.username ||
            item.section_name ||
            item.library_name ||
            item.title ||
            "Unknown",
          plays: item.total_plays ?? item.play_count ?? 0,
        })),
      })),
    });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
