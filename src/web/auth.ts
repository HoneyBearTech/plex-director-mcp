import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";

// Optional shared-password protection for the dashboard.
//
// - Off when WEB_PASSWORD is unset (existing installs keep working; the server
//   warns at startup and the UI shows a banner). On as soon as it is set.
// - WEB_PASSWORD is env-only on purpose, not a Settings-page value: a password
//   editable from an unauthenticated page would defeat the point.
// - A successful login sets a signed, HttpOnly, SameSite=Strict cookie. The
//   session is stateless (an expiry timestamp plus an HMAC), so nothing is
//   stored per login and sessions survive restarts.
// - The signing key is derived from a random secret kept in the database
//   (shared by every process using it) *and* the password, so changing the
//   password signs everyone out.

const COOKIE_NAME = "pd_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET_KEY = "WEB_SESSION_SECRET";

export function getWebPassword(): string {
  return process.env.WEB_PASSWORD?.trim() ?? "";
}

export function isAuthEnabled(): boolean {
  return getWebPassword() !== "";
}

// Created once and stored in the settings table. INSERT OR IGNORE then SELECT
// (rather than check-then-insert) keeps two processes starting together from
// ending up with different secrets.
function getSessionSecret(): string {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(SECRET_KEY, crypto.randomBytes(32).toString("hex"));
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(SECRET_KEY) as { value: string }).value;
}

function signingKey(): Buffer {
  return crypto.createHmac("sha256", getSessionSecret()).update(getWebPassword()).digest();
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const expiresAt = String(now + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expiresAt, signature, ...rest] = token.split(".");
  if (!expiresAt || !signature || rest.length > 0) return false;

  const expected = Buffer.from(sign(expiresAt));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;

  return Number(expiresAt) > now;
}

// Hash both sides first so the comparison is constant-time even when the
// lengths differ.
export function passwordMatches(attempt: string): boolean {
  const sha = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(sha(attempt), sha(getWebPassword()));
}

function readSessionCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return undefined;
}

function isHttps(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function cookieOptions(req: Request) {
  return { httpOnly: true, sameSite: "strict" as const, secure: isHttps(req), path: "/" };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled() || verifySessionToken(readSessionCookie(req))) {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}

// Only failed attempts count toward the limit, so normal use never trips it.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many failed login attempts. Try again in a few minutes." },
});

export const authRouter = Router();

authRouter.get("/status", (req, res) => {
  const authRequired = isAuthEnabled();
  res.json({ authRequired, authenticated: !authRequired || verifySessionToken(readSessionCookie(req)) });
});

authRouter.post("/login", loginLimiter, (req, res) => {
  if (!isAuthEnabled()) {
    res.json({ ok: true });
    return;
  }

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!passwordMatches(password)) {
    res.status(401).json({ error: "Incorrect password." });
    return;
  }

  res.cookie(COOKIE_NAME, createSessionToken(), { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
  res.json({ ok: true });
});
