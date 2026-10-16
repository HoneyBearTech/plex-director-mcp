import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { projectRoot } from "../env.js";
import { authRouter, requireAuth, isAuthEnabled } from "./auth.js";
import { requireAllowedHost } from "./hostCheck.js";
import { trustProxyFromEnv } from "./trustProxy.js";
import { statusRouter } from "./routes/status.js";
import { nodesRouter } from "./routes/nodes.js";
import { queuesRouter } from "./routes/queues.js";
import { settingsRouter } from "./routes/settings.js";
import { chatRouter } from "./routes/chat.js";
import { plexRouter } from "./routes/plex.js";
import { indexersRouter } from "./routes/indexers.js";
import { jobsRouter } from "./routes/jobs.js";

// The built dashboard is one script and one stylesheet from this origin, with
// nothing inline, so injected markup (say a hostile title in a chat answer)
// can't run code or load anything from elsewhere. Images may also be data:
// (chat artwork) or any https URL (public posters from Sonarr and TMDb); the
// page only talks to this server.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function createWebApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind a reverse proxy, req.ip (the rate limits) and req.secure (the
  // cookie's Secure flag) come from its X-Forwarded-* headers, but only when
  // WEB_TRUST_PROXY names it (see trustProxy.ts). An invalid value stops
  // start-up rather than trusting the wrong thing.
  const trustProxy = trustProxyFromEnv();
  app.set("trust proxy", trustProxy);
  if (trustProxy) {
    console.error(`Trusting X-Forwarded-For and X-Forwarded-Proto from: ${trustProxy.join(", ")}`);
  }
  // Browser hardening for every response: the dashboard is never framed (no
  // clickjacking), content types are not sniffed, links don't leak the
  // dashboard's address to other sites, and the page can only run its own
  // script and styles (see CONTENT_SECURITY_POLICY).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  // Chat history carries earlier answers' tables, so requests can be sizeable;
  // 1 MB is ample and still bounded (the default 100 KB rejected long chats).
  app.use(express.json({ limit: "1mb" }));
  // Generous enough for normal dashboard polling (several endpoints polled
  // every 10-15s) while bounding repeated disk reads from the static/SPA
  // handlers below against abuse - flagged by CodeQL as unrate-limited
  // file-system access otherwise.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Everything else, the SPA included, refuses Host names a DNS-rebinding page
  // could use while there's no password (see hostCheck.ts).
  app.use(requireAllowedHost);

  if (!isAuthEnabled()) {
    console.error(
      "WARNING: WEB_PASSWORD is not set - the web dashboard is open to anyone who can reach this port, " +
        "including viewing and changing settings. Set WEB_PASSWORD in .env to require a login.",
    );
  }

  // The login endpoints are public; everything else under /api needs a session
  // (a no-op while WEB_PASSWORD is unset). The static SPA stays public so the
  // login page itself can load.
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth);

  app.use("/api/status", statusRouter);
  app.use("/api/nodes", nodesRouter);
  app.use("/api/queues", queuesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/plex", plexRouter);
  app.use("/api/indexers", indexersRouter);
  app.use("/api/jobs", jobsRouter);

  // Anything under /api that didn't match a router above is a missing or
  // mistyped endpoint - without this, it falls through to the SPA catch-all
  // below and comes back as a 200 HTML page instead of a clear 404.
  app.use("/api/{*splat}", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const staticDir = path.join(projectRoot, "web", "dist");
  app.use(express.static(staticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return app;
}
