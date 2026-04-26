/**
 * Centralised configuration loader.
 *
 * Reads environment variables, validates required ones, exposes a frozen
 * config object. Throws clear errors if required vars are missing.
 *
 * The bot talks to Telegram over MTProto with its bot token (via GramJS),
 * which is why TG_API_ID / TG_API_HASH are required: they identify the
 * client app, the bot token authenticates the bot account. There is no
 * webhook — long-polling MTProto handles updates.
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(v).trim();
}

function num(name, defaultValue, { min, max } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: '${raw}' is not a number`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${name} must be >= ${min}, got ${parsed}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${name} must be <= ${max}, got ${parsed}`);
  }
  return parsed;
}

function csvIntSet(name) {
  const raw = process.env[name] || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const n = Number(s);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          throw new Error(`Invalid ID in ${name}: '${s}'`);
        }
        return n;
      })
  );
}

const NODE_ENV = process.env.NODE_ENV || "development";

const apiId = num("TG_API_ID");
if (!Number.isFinite(apiId) || apiId <= 0) {
  throw new Error(
    "TG_API_ID is required and must be a positive integer (get one at https://my.telegram.org/apps)"
  );
}

const installRoot = path.resolve(__dirname, "..");

const config = Object.freeze({
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === "production",

  // Bot identity from BotFather. Used to authenticate against MTProto.
  botToken: required("BOT_TOKEN"),

  // Telegram client app credentials.
  apiId,
  apiHash: required("TG_API_HASH"),

  // Persisted MTProto session (StringSession). Created on first connect.
  sessionFile:
    process.env.TG_SESSION_FILE || path.join(installRoot, "telegram.session"),

  // Local HTTP server (only serves /health for nginx upstream checks).
  serverPort: num("PORT", 3000, { min: 1, max: 65535 }),
  serverHost: process.env.HOST_BIND || "127.0.0.1",

  // Public host that points to this server (used to build /files/ URLs).
  host: required("HOST")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, ""),

  // Where hosted files live on disk (served straight by nginx).
  uploadDir: path.resolve(
    process.env.UPLOAD_DIR || "/var/lib/tg-filehost/files"
  ),

  // Per-job staging dir for URL → Telegram downloads.
  tempDir: path.resolve(
    process.env.TEMP_DIR || "/var/lib/tg-filehost/temp"
  ),

  allowedUsers: csvIntSet("ALLOWED_USERS"),

  // Caps.
  maxFileMb: num("MAX_FILE_MB", 2048, { min: 1 }),
  maxDownloadMb: num("MAX_DOWNLOAD_MB", 2048, { min: 1 }),

  // Retention. 0 = keep forever.
  retentionDays: num("RETENTION_DAYS", 0, { min: 0 }),
  retentionIntervalMs: num("RETENTION_INTERVAL_MS", 60 * 60 * 1000, {
    min: 60_000,
  }),

  // External-URL fetch settings.
  httpHeadTimeoutMs: num("HTTP_HEAD_TIMEOUT_MS", 15000, { min: 1000 }),
  httpDownloadTimeoutMs: num("HTTP_DOWNLOAD_TIMEOUT_MS", 30 * 60 * 1000, {
    min: 5000,
  }),

  // Temp-dir cleanup (covers leftover .tmp partials older than this).
  tempMaxAgeMs: num("TEMP_MAX_AGE_MS", 60 * 60 * 1000, { min: 60_000 }),
  tempCleanupIntervalMs: num(
    "TEMP_CLEANUP_INTERVAL_MS",
    60 * 60 * 1000,
    { min: 60_000 }
  ),

  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
});

module.exports = config;
