import { server } from "../server.js";
import { tautulliClient } from "../clients.js";
import { textReply, getErrorMessage, rowLabel, rowPlays } from "../util.js";

// Plex playback and historical usage metrics.
export function registerMonitoringTools() {
  server.tool(
    "get_plex_activity",
    "Fetches real-time playback streaming analytics from Plex via Tautulli to monitor user context and transcoding strain.",
    {},
    async () => {
      try {
        const response = await tautulliClient.get("", { params: { cmd: "get_activity" } });
        const data = response.data?.response?.data;

        if (!data || parseInt(data.stream_count, 10) === 0) {
          return textReply("💤 Total Plex streams: 0. The server is completely idle right now.");
        }

        let summary = `📊 Active Server Load:\n- Total Streams: ${data.stream_count}\n- Transcode Count: ${data.stream_count_transcode}\n- Direct Play Count: ${data.stream_count_direct_play}\n\n`;

        const sessions = data.sessions || [];
        sessions.forEach((session: any) => {
          summary += `👤 User: ${session.user} watching "${session.title}" (${session.year || "TV"})\n`;
          summary += `  ↳ Quality: ${session.video_resolution} (${session.stream_container})\n`;
          summary += `  ↳ Processing: ${session.transcode_decision === "transcode" ? `⚠️ Transcoding (${session.video_decision})` : "✓ Direct Play"}\n`;
          summary += `  ↳ Progress: ${session.progress}%\n\n`;
        });

        return textReply(summary);
      } catch (error: unknown) {
        return textReply(`Failed to interface with Tautulli monitoring node: ${getErrorMessage(error)}`, true);
      }
    }
  );

  server.tool(
    "get_library_analytics",
    "Queries historical statistics regarding most watched movies, total user count, and overall watch metrics.",
    {},
    async () => {
      try {
        const response = await tautulliClient.get("", { params: { cmd: "get_home_stats" } });
        const stats = response.data?.response?.data || [];

        if (stats.length === 0) {
          return textReply("No analytics history currently tracked by Tautulli.");
        }

        let richDashboard = "## 🏆 Server Watch History Analytics Dashboard\n";
        richDashboard += "Historical distribution patterns across media libraries and active profile streams.\n\n";

        stats.forEach((category: any) => {
          const categoryTitle = category.stat_title || category.stat_id || "Watch statistics";
          const statId = String(category.stat_id || "");
          richDashboard += `### 📊 ${categoryTitle}\n`;
          richDashboard += "| Rank | Title / Profile Identifier | Total Stream Count |\n";
          richDashboard += "| :---: | :--- | :--- |\n";

          const items = category.rows || [];
          items.slice(0, 3).forEach((item: any, index: number) => {
            const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉";
            const playCount = rowPlays(item);
            const label = rowLabel(statId, item);
            richDashboard += `| ${medal} | **${label}** | \`${playCount} plays\` |\n`;
          });
          richDashboard += "\n";
        });

        return textReply(richDashboard);
      } catch (error: unknown) {
        return textReply(`Failed to process analytics query: ${getErrorMessage(error)}`, true);
      }
    }
  );
}
