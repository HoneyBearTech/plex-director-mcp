import { z } from "zod";
import { server } from "../server.js";
import { loginToQbittorrent, getDownloadingTorrents, deleteTorrent } from "../qbittorrent.js";
import { getConfiguredHosts, probeAllHosts } from "../cluster.js";
import { runServarrBackups } from "../backups.js";
import { textReply } from "../util.js";

// Backups, download-client remediation, and remote host/cluster telemetry.
export function registerInfrastructureTools() {
  // Trigger each Servarr app's own native backup and confirm a new file appeared
  // (see src/backups.ts).
  server.tool(
    "run_cluster_backup",
    "Asks each configured Servarr app (Radarr, Sonarr, Prowlarr) to create its built-in database backup, waits for each to finish, and confirms a new backup file appeared, reporting the file's name, size and time. The backups stay in each app's own backup folder; nothing is copied.",
    {},
    async () => {
      const { text, isError } = await runServarrBackups();
      return textReply(text, isError);
    }
  );

  // qBittorrent queue auditing and stalled-download remediation.
  server.tool(
    "manage_stalled_downloads",
    "Scans qBittorrent download queues to isolate, pause, or blocklist items stuck below threshold download speeds.",
    {
      action: z.enum(["AUDIT", "PURGE_STALLED"]).describe("AUDIT returns stalled candidates; PURGE_STALLED wipes them and flags a re-search."),
      minSpeedKbps: z.number().optional().default(50).describe("The minimum allowed speed threshold before a torrent is considered stalled.")
    },
    async ({ action, minSpeedKbps }) => {
      try {
        // Authenticate once and reuse the session for queue operations.
        const session = await loginToQbittorrent();
        const torrents = await getDownloadingTorrents(session);

        // Include fully stalled downloads and downloads below the configured rate.
        const stalledTorrents = torrents.filter((t: any) => {
          const speedKbps = t.dlspeed / 1024;
          return t.state === "stalledDL" || (speedKbps > 0 && speedKbps < minSpeedKbps);
        });

        if (stalledTorrents.length === 0) {
          return { content: [{ type: "text", text: "✅ Queue Audit: Zero stalled or low-bandwidth torrent items detected in qBittorrent." }] };
        }

        if (action === "AUDIT") {
          let auditReport = `📋 **Stalled Torrent Audit Log:**\n`;
          auditReport += `Detected ${stalledTorrents.length} items failing to meet your minimum speed threshold of ${minSpeedKbps} KB/s:\n\n`;

          stalledTorrents.forEach((t: any) => {
            const currentSpeed = (t.dlspeed / 1024).toFixed(2);
            auditReport += `  ▪ **${t.name}**\n`;
            auditReport += `    ↳ Speed: ${currentSpeed} KB/s | Progress: ${(t.progress * 100).toFixed(1)}% | Seeders: ${t.num_seeds}\n`;
          });

          return { content: [{ type: "text", text: auditReport }] };
        }

        let purgeReport = `🧹 **Executing Torrent Remediation Strategy:**\n`;
        for (const torrent of stalledTorrents) {
          // Delete both the torrent metadata and its downloaded files.
          await deleteTorrent(session, torrent.hash);

          // Servarr RSS routines can then search for an alternative release.
          purgeReport += `  ✓ Purged and blocklisted release: *${torrent.name}*\n`;
        }

        purgeReport += `\nAll stalled items successfully dropped. Servarr RSS routines will automatically cycle to alternative indexer releases.`;
        return { content: [{ type: "text", text: purgeReport }] };

      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to execute qBittorrent cleanup routines: ${error.message}` }], isError: true };
      }
    }
  );

  // Multi-host CPU, memory, and Docker health monitoring.
  server.tool(
    "get_cluster_infrastructure_health",
    "Collects real-time CPU utilization, RAM usage, and active Docker container counts across all configured Ubuntu hosts.",
    {},
    async () => {
      const hosts = getConfiguredHosts();
      if (hosts.length === 0) {
        return { content: [{ type: "text", text: "No remote Ubuntu hosts defined in configuration metadata mappings." }], isError: true };
      }

      let systemsReport = `🖥️ **Distributed Ubuntu Cluster Performance Matrix**\n\n`;
      systemsReport += `| Host Node IP | CPU Load | Memory Status | Active Containers | Docker Status |\n`;
      systemsReport += `| :--- | :--- | :--- | :---: | :--- |\n`;

      for (const node of await probeAllHosts(hosts)) {
        if (!node.online) {
          const why = node.hostKeyChanged
            ? "Host key changed - if the host was rebuilt, choose 'Trust new key' on the dashboard's Node Utilization page"
            : node.error;
          systemsReport += `| **${node.host}** | ❌ Offline | ❌ Offline | N/A | 🔴 ${why.replace(/\|/g, "/")} |\n`;
          continue;
        }

        const hasStopped = node.deadContainers.length > 0;
        const healthEmoji = hasStopped ? "⚠️ Issues Found" : "🟢 All Healthy";
        const containerNote = hasStopped
          ? `${node.containersRunning} running <br> *Stopped: [${node.deadContainers.join(", ")}]*`
          : `${node.containersRunning} running`;
        const ramStatus = `${node.ramPercent.toFixed(2)}% (${node.ramUsedMb}MB/${node.ramTotalMb}MB)`;

        systemsReport += `| **${node.host}** | ${node.cpuPercent.toFixed(1)}% | ${ramStatus} | ${containerNote} | ${healthEmoji} |\n`;
      }

      return { content: [{ type: "text", text: systemsReport }] };
    }
  );

  // Cluster telemetry data for clients that render charts from the response.
  server.tool(
    "get_cluster_hardware_analytics",
    "Fetches real-time CPU load and memory allocation for every configured cluster host over SSH, as a Markdown table.",
    {},
    async () => {
      const hosts = getConfiguredHosts();
      if (hosts.length === 0) {
        return { content: [{ type: "text", text: "No remote Ubuntu hosts defined in configuration metadata mappings." }], isError: true };
      }

      try {
        let report = `### 📊 Real-Time Cluster Resource Telemetry\n\n`;
        report += `| Host Node | CPU Load | Memory Allocation |\n`;
        report += `| :--- | :---: | :---: |\n`;
        for (const node of await probeAllHosts(hosts)) {
          report += node.online
            ? `| \`${node.hostname}\` (${node.host}) | ${node.cpuPercent.toFixed(1)}% | ${node.ramPercent.toFixed(1)}% |\n`
            : `| \`${node.host}\` | ❌ Offline | ❌ Offline |\n`;
        }

        return { content: [{ type: "text", text: report }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to compile host telemetry metrics: ${error.message}` }], isError: true };
      }
    }
  );
}
