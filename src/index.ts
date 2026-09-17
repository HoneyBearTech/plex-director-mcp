import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";
import { registerMovieTools } from "./tools/movies.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerInfrastructureTools } from "./tools/infrastructure.js";
import { createWebApp } from "./web/app.js";

registerMovieTools();
registerMonitoringTools();
registerJobTools();
registerDiscoveryTools();
registerInfrastructureTools();

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Plex Director MCP server running on Stdio");
}

function runWebServer() {
  const port = Number(process.env.WEB_PORT) || 3000;
  createWebApp().listen(port, () => {
    console.error(`Plex Director web UI listening on port ${port}`);
  });
}

run().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});

runWebServer();
