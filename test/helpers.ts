import "./setup.js";
import { AxiosError, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  params: Record<string, unknown>;
  // Parsed JSON when the body is JSON, otherwise the raw string.
  body: unknown;
  headers: Record<string, string>;
}

export type FakeReply = { status?: number; data?: unknown; headers?: Record<string, string | string[]> };
type Handler = (req: RecordedRequest) => FakeReply | Promise<FakeReply>;

function record(config: InternalAxiosRequestConfig): RecordedRequest {
  let body: unknown = config.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      /* form-encoded or plain text - keep the string */
    }
  }
  const headers = typeof (config.headers as any)?.toJSON === "function" ? (config.headers as any).toJSON() : { ...config.headers };
  return { method: String(config.method).toLowerCase(), url: String(config.url), params: (config.params ?? {}) as Record<string, unknown>, body, headers };
}

// Replaces an axios client's transport with a fake. Reply with an object for a
// response, or throw from the handler to simulate a network failure. Non-2xx
// statuses reject like real axios does.
export function fakeApi(client: AxiosInstance, handler: Handler): { calls: RecordedRequest[]; restore: () => void } {
  const previous = client.defaults.adapter;
  const calls: RecordedRequest[] = [];

  client.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const req = record(config);
    calls.push(req);
    const reply = await handler(req);
    const response: AxiosResponse = {
      data: reply.data ?? {},
      status: reply.status ?? 200,
      statusText: "",
      headers: reply.headers ?? {},
      config,
    };
    if (response.status >= 400) {
      throw new AxiosError(`Request failed with status code ${response.status}`, "ERR_BAD_REQUEST", config, null, response);
    }
    return response;
  };

  return {
    calls,
    restore: () => {
      if (previous === undefined) delete client.defaults.adapter;
      else client.defaults.adapter = previous;
    },
  };
}

// Boots the real Express app on an ephemeral port.
export async function startApp(): Promise<{ base: string; close: () => Promise<void> }> {
  const { createWebApp } = await import("../src/web/app.js");
  const server: Server = createWebApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Hard stop against the failure this guard exists for: an earlier version of
// this suite ran without its setup file and wiped the developer's real
// settings table. Anything that writes to the database must pass through here.
export function assertIsolated(): void {
  const dbPath = process.env.PLEX_DIRECTOR_DB_PATH ?? "";
  const tmp = os.tmpdir();
  if (process.env.PLEX_DIRECTOR_SKIP_DOTENV !== "1" || !dbPath.startsWith(tmp) || !path.basename(path.dirname(dbPath)).startsWith("plex-director-test-")) {
    throw new Error(`Refusing to touch a database that isn't a test one (PLEX_DIRECTOR_DB_PATH=${JSON.stringify(dbPath)}). Import "./setup.js" first.`);
  }
}

// Empties the tables the tests write to.
export async function resetDb(): Promise<void> {
  assertIsolated();
  const { db } = await import("../src/db.js");
  db.exec("DELETE FROM system_jobs; DELETE FROM interaction_context; DELETE FROM settings; DELETE FROM ssh_host_keys; DELETE FROM sqlite_sequence WHERE name='system_jobs';");
}
