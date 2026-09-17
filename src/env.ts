import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(sourceDirectory, "..");

dotenv.config({ path: path.resolve(projectRoot, ".env") });

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
