import { type AxiosResponse, isAxiosError } from "axios";
import { qbitClient } from "./clients.js";
import { getSetting } from "./settings.js";
import type { QbitTorrent } from "./types/qbittorrent.js";

// The one place that knows how to talk to qBittorrent's Web API: log in, reuse
// the session cookie, list downloads, delete torrents. Used by the dashboard's
// queue route and the manage_stalled_downloads MCP tool.

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

export interface QbitSession {
  headers: { Cookie?: string };
}

const BAD_CREDENTIALS =
  "qBittorrent login failed - check the qBittorrent username and password in Settings.";

// How qBittorrent answers POST /api/v2/auth/login (checked against its source):
// - up to 5.1 (Web API 2.11): 200 with "Ok." on success, 200 with "Fails." on
//   bad credentials;
// - from 5.2 (Web API 2.14): 204 with no body on success, 401 on bad
//   credentials;
// - every version: 403 while the client's IP is banned after too many failed
//   logins, and 401 when its Host header or CSRF check fails.
// Without these checks a wrong password only surfaces later as an unhelpful
// 403 from the next request.
export async function loginToQbittorrent(): Promise<QbitSession> {
  let response: AxiosResponse<unknown>;
  try {
    response = await qbitClient.post(
      "/api/v2/auth/login",
      `username=${encodeURIComponent(getSetting("QBITTORRENT_USER"))}&password=${encodeURIComponent(getSetting("QBITTORRENT_PASS"))}`,
      { headers: FORM },
    );
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (status === 401) {
      throw new Error(
        `${BAD_CREDENTIALS} If they are correct, qBittorrent's host header validation may be refusing the address in the qBittorrent URL.`,
      );
    }
    if (status === 403) {
      throw new Error(
        "qBittorrent login refused - qBittorrent has banned this server's IP address after too many failed logins. Wait for the ban to end (or restart qBittorrent), then check the qBittorrent username and password in Settings.",
      );
    }
    throw error;
  }

  const body = typeof response.data === "string" ? response.data.trim() : response.data;
  if (body === "Fails.") throw new Error(BAD_CREDENTIALS);
  if (body !== "Ok." && body !== "" && body != null) {
    throw new Error(
      `qBittorrent login failed - unexpected reply (HTTP ${response.status}); check that the qBittorrent URL in Settings points at qBittorrent's Web UI.`,
    );
  }

  // A client qBittorrent lets in without a password (localhost, or a
  // whitelisted subnet) may get no cookie at all; it needs none.
  const cookie = sessionCookie(response.headers["set-cookie"]);
  return { headers: cookie ? { Cookie: cookie } : {} };
}

// "SID=abc; HttpOnly; path=/" -> just "SID=abc" for the Cookie header. The
// session cookie is SID up to 5.1 (renameable in its config) and QBT_SID_<port>
// from 5.2; anything else a proxy adds is left out.
function sessionCookie(setCookie: string[] | undefined): string | undefined {
  const pairs = (setCookie ?? [])
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("="));
  return pairs.find((pair) => /^(SID|QBT_SID_\d+)=/.test(pair)) ?? pairs[0];
}

export async function getDownloadingTorrents(session: QbitSession): Promise<QbitTorrent[]> {
  const response = await qbitClient.get<QbitTorrent[]>(
    "/api/v2/torrents/info?filter=downloading",
    session,
  );
  return response.data || [];
}

export async function deleteTorrent(
  session: QbitSession,
  hash: string,
  deleteFiles = true,
): Promise<void> {
  await qbitClient.post(
    "/api/v2/torrents/delete",
    `hashes=${encodeURIComponent(hash)}&deleteFiles=${deleteFiles}`,
    {
      headers: { ...session.headers, ...FORM },
    },
  );
}
