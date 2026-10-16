import { z } from "zod";
import { server } from "../server.js";
import { auditStalled, DEFAULT_MIN_SPEED_KBPS, purgeStalled } from "../stalledDownloads.js";
import { getConfiguredHosts, probeAllHosts, trustNewHostKey } from "../cluster.js";
import { runServarrBackups } from "../backups.js";
import { textReply, getErrorMessage } from "../util.js";

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
    },
  );

  // qBittorrent queue auditing and stalled-download clean-up (src/stalledDownloads.ts).
  server.tool(
    "manage_stalled_downloads",
    "Lists qBittorrent downloads that are stalled or slower than a threshold (AUDIT), and deletes chosen ones with their downloaded files (PURGE_STALLED). PURGE_STALLED only deletes the torrents whose hashes you pass, taken from an AUDIT the user has seen and agreed to; it never deletes anything else, and Radarr and Sonarr are not told.",
    {
      action: z
        .enum(["AUDIT", "PURGE_STALLED"])
        .describe(
          "AUDIT lists stalled downloads with their hashes and changes nothing; PURGE_STALLED deletes the torrents named in hashes, with their files.",
        ),
      hashes: z
        .array(z.string())
        .optional()
        .describe(
          "PURGE_STALLED only: the hashes, from AUDIT, of the torrents the user agreed to delete. Required for PURGE_STALLED.",
        ),
      minSpeedKbps: z
        .number()
        .min(0)
        .optional()
        .default(DEFAULT_MIN_SPEED_KBPS)
        .describe(
          "A download slower than this (KB/s) counts as stalled, as does one qBittorrent reports as stalled.",
        ),
    },
    async ({ action, hashes, minSpeedKbps }) => {
      const { text, isError } =
        action === "AUDIT"
          ? await auditStalled(minSpeedKbps)
          : await purgeStalled(hashes ?? [], minSpeedKbps);
      return textReply(text, isError);
    },
  );

  // Multi-host CPU, memory, and Docker health monitoring.
  server.tool(
    "get_cluster_infrastructure_health",
    "Collects real-time CPU utilization, RAM usage, and active Docker container counts across all configured Ubuntu hosts.",
    {},
    async () => {
      const hosts = getConfiguredHosts();
      if (hosts.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No remote Ubuntu hosts defined in configuration metadata mappings.",
            },
          ],
          isError: true,
        };
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
    },
  );

  // The MCP counterpart of the dashboard's "Trust new key" button, which needs
  // WEB_PASSWORD. It changes which machine is trusted as the host, so it is
  // never one of the chat's tools.
  server.tool(
    "trust_new_host_key",
    "Forgets the remembered SSH key of a monitored host so the next check trusts the key it presents now. Only for a host the user rebuilt or reinstalled: an unexpected key change can mean another machine is impersonating it. Confirm with the user first.",
    {
      host: z
        .string()
        .describe(
          "The host exactly as configured in UBUNTU_HOSTS, e.g. 192.168.1.10 or host:2222.",
        ),
    },
    async ({ host }) => {
      const result = trustNewHostKey(host);
      if (!result.ok) {
        return textReply(
          `${result.error} Configured: ${getConfiguredHosts().join(", ") || "none"}.`,
          true,
        );
      }
      return textReply(
        result.hadRememberedKey
          ? `Forgot the remembered SSH key for ${host}. The next check (or get_cluster_infrastructure_health) remembers the key it presents now.`
          : `No key was remembered for ${host}; the next check remembers the one it presents.`,
      );
    },
  );

  // Cluster telemetry data for clients that render charts from the response.
  server.tool(
    "get_cluster_hardware_analytics",
    "Fetches real-time CPU load and memory allocation for every configured cluster host over SSH, as a Markdown table.",
    {},
    async () => {
      const hosts = getConfiguredHosts();
      if (hosts.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No remote Ubuntu hosts defined in configuration metadata mappings.",
            },
          ],
          isError: true,
        };
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
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to compile host telemetry metrics: ${getErrorMessage(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
