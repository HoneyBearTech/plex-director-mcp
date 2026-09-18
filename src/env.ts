import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(sourceDirectory, "..");

dotenv.config({ path: path.resolve(projectRoot, ".env") });
