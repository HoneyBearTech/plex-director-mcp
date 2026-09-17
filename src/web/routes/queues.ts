import { Router } from "express";
import { sabnzbdClient, qbitClient } from "../../clients.js";
import { getErrorMessage } from "../../util.js";
import { getSetting } from "../../settings.js";

export const queuesRouter = Router();

queuesRouter.get("/sabnzbd", async (_req, res) => {
  try {
    const response = await sabnzbdClient.get("", { params: { mode: "queue" } });
    const slots = response.data?.queue?.slots || [];

    res.json({
      items: slots.map((slot: any) => ({
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
    const loginResponse = await qbitClient.post(
      "/api/v2/auth/login",
      `username=${encodeURIComponent(getSetting("QBITTORRENT_USER"))}&password=${encodeURIComponent(getSetting("QBITTORRENT_PASS"))}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const cookie = loginResponse.headers["set-cookie"];
    const requestConfig = { headers: { Cookie: cookie ? cookie[0] : "" } };

    const torrentsResponse = await qbitClient.get("/api/v2/torrents/info", requestConfig);
    const torrents = torrentsResponse.data || [];

    res.json({
      items: torrents.map((torrent: any) => ({
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
