import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";
import { registerMovieTools } from "./tools/movies.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerInfrastructureTools } from "./tools/infrastructure.js";
import { createWebApp } from "./web/app.js";
import { prepareStoredSecrets, seedSettingsFromEnv } from "./settings.js";
import { getErrorMessage } from "./util.js";
import { refreshClients } from "./clients.js";
import { startJobRunner } from "./jobRunner.js";

// Before anything reads a credential: check the encryption key fits what is
// stored, and encrypt any credential still in plain text. stderr only:
// stdout belongs to the MCP protocol.
try {
  const secrets = prepareStoredSecrets();
  if (secrets.forgotten.length > 0)
    console.error(`Deleted unreadable saved credentials: ${secrets.forgotten.join(", ")}.`);
  if (secrets.encrypted > 0)
    console.error(
      `🔐 Encrypted ${secrets.encrypted} saved credential${secrets.encrypted === 1 ? "" : "s"} with SETTINGS_ENCRYPTION_KEY.`,
    );
  if (!secrets.keySet)
    console.error(
      "WARNING: SETTINGS_ENCRYPTION_KEY is not set - saved service credentials are stored in plain text in the database.",
    );
} catch (error) {
  console.error(`❌ ${getErrorMessage(error)}`);
  process.exit(1);
}

// First boot: copy any configured .env values into the settings store so
// there's something to seed from. After that, whatever's saved via the
// Settings page takes precedence over .env for that key.
seedSettingsFromEnv();
refreshClients();

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
startJobRunner();
