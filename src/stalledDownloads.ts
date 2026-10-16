import { deleteTorrent, getDownloadingTorrents, loginToQbittorrent } from "./qbittorrent.js";
import type { QbitTorrent } from "./types/qbittorrent.js";
import { getErrorMessage } from "./util.js";

// manage_stalled_downloads: AUDIT lists what is stalled; PURGE_STALLED deletes
// torrents and their files, so it only deletes the ones named by hash, which
// come from an AUDIT the user has seen. Approving the tool call then means
// approving that list, not "whatever happens to be stalled right now". A named
// torrent that is gone or downloading properly again is left alone.

export const DEFAULT_MIN_SPEED_KBPS = 50;

export function isStalled(torrent: QbitTorrent, minSpeedKbps: number): boolean {
  const speedKbps = torrent.dlspeed / 1024;
  return torrent.state === "stalledDL" || (speedKbps > 0 && speedKbps < minSpeedKbps);
}

export interface StalledReply {
  text: string;
  isError: boolean;
}

const line = (t: QbitTorrent) =>
  `- **${t.name}** (hash \`${t.hash}\`): ${(t.dlspeed / 1024).toFixed(2)} KB/s, ${(t.progress * 100).toFixed(1)}% done, ${t.num_seeds} seeders${t.state === "stalledDL" ? ", stalled" : ""}`;

export async function auditStalled(minSpeedKbps: number): Promise<StalledReply> {
  try {
    const torrents = await getDownloadingTorrents(await loginToQbittorrent());
    const stalled = torrents.filter((t) => isStalled(t, minSpeedKbps));
    if (stalled.length === 0) {
      return {
        text: `No stalled downloads in qBittorrent (stalled, or slower than ${minSpeedKbps} KB/s).`,
        isError: false,
      };
    }
    return {
      text:
        `## Stalled downloads in qBittorrent\n${stalled.length} stalled, or slower than ${minSpeedKbps} KB/s. Nothing was changed.\n\n` +
        `${stalled.map(line).join("\n")}\n\n` +
        "To delete some of them with their downloaded files, show the user this list and get their go-ahead, then call PURGE_STALLED with the hashes they agreed to. Radarr and Sonarr are not told, so they may grab the same release again.",
      isError: false,
    };
  } catch (error) {
    return { text: `Failed to read qBittorrent: ${getErrorMessage(error)}`, isError: true };
  }
}

export async function purgeStalled(hashes: string[], minSpeedKbps: number): Promise<StalledReply> {
  const wanted = [...new Set(hashes.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) {
    return {
      text: "PURGE_STALLED needs the hashes of the torrents to delete. Run AUDIT, show the user the list, and pass the hashes they agreed to. Nothing was deleted.",
      isError: true,
    };
  }
  const deleted: QbitTorrent[] = [];
  const skipped: string[] = [];
  try {
    const session = await loginToQbittorrent();
    const byHash = new Map(
      (await getDownloadingTorrents(session)).map((t) => [t.hash.toLowerCase(), t]),
    );
    for (const hash of wanted) {
      const torrent = byHash.get(hash);
      if (!torrent) skipped.push(`\`${hash}\`: not downloading in qBittorrent any more`);
      else if (!isStalled(torrent, minSpeedKbps))
        skipped.push(`**${torrent.name}**: downloading normally again`);
      else {
        await deleteTorrent(session, torrent.hash);
        deleted.push(torrent);
      }
    }

    let text = `## Stalled downloads: deleted ${deleted.length} of ${wanted.length}\n`;
    for (const t of deleted) text += `- Deleted from qBittorrent, with its files: **${t.name}**\n`;
    if (skipped.length > 0) text += `\nLeft alone:\n${skipped.map((s) => `- ${s}`).join("\n")}\n`;
    // Only qBittorrent is touched: nothing is blocklisted in Radarr or Sonarr.
    if (deleted.length > 0)
      text +=
        "\nRadarr and Sonarr were not told, so nothing was blocklisted: they may grab the same release again. To avoid that, remove it from their queue with the blocklist option instead.";
    return { text: text.trimEnd(), isError: false };
  } catch (error) {
    return {
      text: `Failed to clean up qBittorrent: ${getErrorMessage(error)}. ${deleted.length > 0 ? `Already deleted, with their files: ${deleted.map((t) => t.name).join("; ")}.` : "Nothing was deleted."}`,
      isError: true,
    };
  }
}
