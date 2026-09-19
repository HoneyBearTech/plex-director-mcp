import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_VERSION } from "./version.js";

export const server = new McpServer({
  name: "plex-director",
  version: APP_VERSION,
});
