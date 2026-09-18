import { Router } from "express";
import { tautulliClient } from "../../clients.js";
import { getErrorMessage, rowLabel, rowPlays } from "../../util.js";

export const statusRouter = Router();

// Tautulli image paths look like "/library/metadata/12345/thumb/167834923"
// or ".../art/...". They're relative to the underlying Plex server and only
// resolvable through Tautulli's own pms_image_proxy (which needs the
// Tautulli API key) - so the frontend never sees that path directly, only
// this proxy URL.
function posterProxyUrl(imgPath: string | undefined | null): string | null {
  if (!imgPath) return null;
  return `/api/status/image?path=${encodeURIComponent(imgPath)}`;
}

// Only one image makes sense per row, matching whatever rowLabel picked -
// a user's avatar for "who" categories, a poster for "what" categories
// (including last_watched, which is media-centric despite also carrying
// viewer fields), none for platforms/concurrent-streams rows.
function rowImage(statId: string, item: any): { posterUrl: string | null; userThumb: string | null } {
  if (statId === "top_users") {
    return { posterUrl: null, userThumb: item.user_thumb || null };
  }
  if (statId === "top_platforms" || statId === "most_concurrent") {
    return { posterUrl: null, userThumb: null };
  }
  return { posterUrl: posterProxyUrl(item.grandparent_thumb || item.thumb), userThumb: null };
}

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
        userThumb: session.user_thumb || null,
        title: session.title,
        year: session.year ?? null,
        resolution: session.video_resolution,
        container: session.stream_container,
        transcoding: session.transcode_decision === "transcode",
        progress: Number(session.progress ?? 0),
        posterUrl: posterProxyUrl(session.grandparent_thumb || session.thumb),
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
          label: rowLabel(category.stat_id, item),
          plays: rowPlays(item),
          ...rowImage(category.stat_id, item),
        })),
      })),
    });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});

statusRouter.get("/image", async (req, res) => {
  const path = String(req.query.path ?? "");
  if (!/^\/library\/metadata\/\d+\/(thumb|art)\/\d+$/.test(path)) {
    res.status(400).json({ error: "invalid image path" });
    return;
  }

  try {
    const response = await tautulliClient.get("", {
      params: { cmd: "pms_image_proxy", img: path, width: 150, height: 225 },
      responseType: "arraybuffer",
    });
    res.setHeader("Content-Type", String(response.headers["content-type"] || "image/jpeg"));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(response.data));
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
