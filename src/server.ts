import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_VERSION } from "./version.js";
import { SERVER_INSTRUCTIONS } from "./guidance.js";

export const server = new McpServer(
  {
    name: "plex-director",
    version: APP_VERSION,
  },
  // Sent to every MCP client in the initialize result (see src/guidance.ts).
  { instructions: SERVER_INSTRUCTIONS }
);
