import { rateLimit } from "express-rate-limit";

/*
 * Minimal, defense-in-depth rate limiting. Firebase already throttles
 * credential/token issuance client-side, so these guard the backend's
 * own abuse surface (provisioning + memory-buffered uploads) without
 * getting in the way of ordinary use or the automated test suites.
 *
 * Set RATE_LIMIT_ENABLED=false to bypass entirely (e.g. load testing).
 * Keying is per-IP; behind a real proxy in production, also set
 * `app.set("trust proxy", 1)` so the client IP is read correctly.
 */
const DISABLED = process.env.RATE_LIMIT_ENABLED === "false";

const json = {
  success: false,
  message: "Too many requests. Please wait a moment and try again.",
};

/* Loose global safety net — an order of magnitude above any real user. */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: json,
  skip: (request) =>
    DISABLED || request.path === "/api/health" || request.path.startsWith("/api/health/"),
});

/* Account provisioning: the one unauthenticated-ish write path. */
export const authSyncLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: json,
  skip: () => DISABLED,
});

/* Uploads buffer the whole file in memory before validation — cap the
 * rate so a single client cannot exhaust RAM. Generous enough for the
 * multi-upload test suites. */
export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: json,
  skip: () => DISABLED,
});
