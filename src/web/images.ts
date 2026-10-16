import type { AxiosResponse } from "axios";
import type { Response } from "express";
import { imageType } from "../util.js";

// Sends an image fetched from Plex or Tautulli. Anything that isn't an image
// (an HTML error page, say) is refused rather than served from the dashboard's
// own origin. The response sits behind the dashboard login, so only this
// browser may cache it, never a shared cache.
export function sendImage(res: Response, upstream: AxiosResponse<ArrayBuffer>): void {
  const type = imageType(upstream.headers["content-type"]);
  if (!type) {
    res.status(502).json({ error: "the server did not return an image" });
    return;
  }
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.send(Buffer.from(upstream.data));
}
