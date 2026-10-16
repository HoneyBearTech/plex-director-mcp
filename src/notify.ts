import axios from "axios";
import { getErrorMessage } from "./util.js";

// Send optional rich status alerts without making Discord a hard dependency.
export async function sendDiscordNotification(
  title: string,
  description: string,
  color: number = 3066993,
) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, {
      embeds: [
        {
          title: title,
          description: description,
          color: color,
          timestamp: new Date().toISOString(),
          footer: { text: "Plex Director MCP Node" },
        },
      ],
    });
  } catch (error: unknown) {
    console.error(`Failed to dispatch alert matrix to Discord: ${getErrorMessage(error)}`);
  }
}
