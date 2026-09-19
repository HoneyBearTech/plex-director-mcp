import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./env.js";

// The version in package.json, so the MCP server reports what was actually
// released instead of a number someone has to remember to bump. package.json
// is present in the Docker image too (Node needs it for "type": "module").
export const APP_VERSION: string = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;
