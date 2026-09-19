import { qbitClient } from "./clients.js";
import { getSetting } from "./settings.js";

// The one place that knows how to talk to qBittorrent's Web API: log in, reuse
// the session cookie, list downloads, delete torrents. Used by the dashboard's
// queue route and the manage_stalled_downloads MCP tool.

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

export interface QbitSession {
  headers: { Cookie: string };
}

export async function loginToQbittorrent(): Promise<QbitSession> {
  const response = await qbitClient.post(
    "/api/v2/auth/login",
    `username=${encodeURIComponent(getSetting("QBITTORRENT_USER"))}&password=${encodeURIComponent(getSetting("QBITTORRENT_PASS"))}`,
    { headers: FORM }
  );

  // qBittorrent answers 200 either way: "Ok." on success, "Fails." on bad
  // credentials. Without this check a wrong password only surfaces later as an
  // unhelpful 403 from the next request.
  if (typeof response.data === "string" && response.data.trim() !== "Ok.") {
    throw new Error("qBittorrent login failed - check the qBittorrent username and password in Settings.");
  }

  // "SID=abc; HttpOnly; path=/" -> just "SID=abc" for the Cookie header.
  const setCookie = response.headers["set-cookie"];
  const sessionCookie = setCookie?.[0]?.split(";")[0] ?? "";
  return { headers: { Cookie: sessionCookie } };
}

export async function getDownloadingTorrents(session: QbitSession): Promise<any[]> {
  const response = await qbitClient.get("/api/v2/torrents/info?filter=downloading", session);
  return response.data || [];
}

export async function deleteTorrent(session: QbitSession, hash: string, deleteFiles = true): Promise<void> {
  await qbitClient.post("/api/v2/torrents/delete", `hashes=${hash}&deleteFiles=${deleteFiles}`, {
    headers: { ...session.headers, ...FORM },
  });
}
