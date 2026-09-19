import { Router } from "express";
import { plexClient } from "../../clients.js";
import { getErrorMessage } from "../../util.js";

export const plexRouter = Router();

// Plex poster paths look like "/library/metadata/91684/thumb/1789285096".
// Fetching them needs the Plex token, which must never reach the browser, so
// the frontend only ever sees this proxy URL. Going through Plex's transcoder
// resizes to a row-sized thumbnail (~10 KB instead of ~220 KB for the original).
plexRouter.get("/image", async (req, res) => {
  const path = String(req.query.path ?? "");
  if (!/^\/library\/metadata\/\d+\/thumb\/\d+$/.test(path)) {
    res.status(400).json({ error: "invalid image path" });
    return;
  }

  try {
    const response = await plexClient.get("/photo/:/transcode", {
      params: { url: path, width: 150, height: 225, minSize: 1, upscale: 1 },
      responseType: "arraybuffer",
    });
    res.setHeader("Content-Type", String(response.headers["content-type"] || "image/jpeg"));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(response.data));
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
