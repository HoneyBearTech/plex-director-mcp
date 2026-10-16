import { Router } from "express";
import { sabnzbdClient } from "../../clients.js";
import { getErrorMessage } from "../../util.js";
import { loginToQbittorrent, getDownloadingTorrents } from "../../qbittorrent.js";
import type { SabnzbdQueueResponse } from "../../types/sabnzbd.js";

export const queuesRouter = Router();

queuesRouter.get("/sabnzbd", async (_req, res) => {
  try {
    const response = await sabnzbdClient.get<SabnzbdQueueResponse>("", {
      params: { mode: "queue" },
    });
    const slots = response.data?.queue?.slots || [];

    res.json({
      items: slots.map((slot) => ({
        filename: slot.filename,
        status: slot.status,
        percentage: Number(slot.percentage) || 0,
        timeleft: slot.timeleft,
        sizeMb: Number(slot.mb) || 0,
        sizeLeftMb: Number(slot.mbleft) || 0,
      })),
    });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});

queuesRouter.get("/qbittorrent", async (_req, res) => {
  try {
    const torrents = await getDownloadingTorrents(await loginToQbittorrent());

    res.json({
      items: torrents.map((torrent) => ({
        name: torrent.name,
        state: torrent.state,
        progress: Number(torrent.progress) || 0,
        dlspeedKbps: (Number(torrent.dlspeed) || 0) / 1024,
        sizeBytes: Number(torrent.size) || 0,
        seeders: Number(torrent.num_seeds) || 0,
        stalled: torrent.state === "stalledDL",
      })),
    });
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
