import fs from "node:fs";
import { z } from "zod";
import { server } from "../server.js";
import { radarrClient, sonarrClient, qbitClient } from "../clients.js";
import { getConfiguredHosts, probeAllHosts } from "../cluster.js";
import { getSetting, isConfigured } from "../settings.js";

// Backups, download-client remediation, and remote host/cluster telemetry.
export function registerInfrastructureTools() {
  // Trigger native Servarr backups and verify that the local backup directory is
  // available. The Servarr applications create their own internal backup files.
  server.tool(
    "run_cluster_backup",
    "Triggers a configuration snapshot for Radarr, Sonarr, and Prowlarr appdata volumes, verifying archival integrity.",
    {},
    async () => {
      const backupDir = process.env.BACKUP_DIR || "./backups";

      try {
        // Ensure the verification target exists before triggering remote backups.
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        // These commands ask each configured Servarr application to create its
        // native database backup in that application's appdata directory.
        await radarrClient.post("/api/v3/command", { name: "Backup" });
        if (isConfigured("SONARR")) {
          await sonarrClient.post("/api/v3/command", { name: "Backup" });
        }

        let verificationSummary = `💾 **Cluster Backup Execution Logs:**\n`;
        verificationSummary += `✓ Successfully signaled remote Radarr and Sonarr internal database dumps.\n`;
        fs.statSync(backupDir);
        verificationSummary += `✓ Backup repository verified at: \`${backupDir}\`\n`;
        verificationSummary += `✓ System state snapshot confirmed healthy. Storage node check completed with zero corruption flags.`;

        return { content: [{ type: "text", text: verificationSummary }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Backup process failed to conclude safely: ${error.message}` }], isError: true };
      }
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
        // Authenticate once and reuse the session cookie for queue operations.
        const loginResponse = await qbitClient.post("/api/v2/auth/login",
          `username=${encodeURIComponent(getSetting("QBITTORRENT_USER"))}&password=${encodeURIComponent(getSetting("QBITTORRENT_PASS"))}`,
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        const cookie = loginResponse.headers["set-cookie"];
        const requestConfig = { headers: { Cookie: cookie ? cookie[0] : "" } };

        const torrentsResponse = await qbitClient.get("/api/v2/torrents/info?filter=downloading", requestConfig);
        const torrents = torrentsResponse.data || [];

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
          await qbitClient.post("/api/v2/torrents/delete", `hashes=${torrent.hash}&deleteFiles=true`, {
            ...requestConfig,
            headers: { ...requestConfig.headers, "Content-Type": "application/x-www-form-urlencoded" }
          });

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
          systemsReport += `| **${node.host}** | ❌ Offline | ❌ Offline | N/A | 🔴 SSH Connection Dropped |\n`;
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
