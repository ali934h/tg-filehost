"use strict";

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(v).trim();
}

function parseList(v) {
  return (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const cfg = {
  apiId: Number(required("API_ID")),
  apiHash: required("API_HASH"),
  phone: process.env.PHONE || "",
  session: process.env.SESSION || "",
  allowedUsers: parseList(process.env.ALLOWED_USERS),
  allowedChats: parseList(process.env.ALLOWED_CHATS),
  host: required("HOST").replace(/^https?:\/\//, "").replace(/\/$/, ""),
  port: Number(process.env.PORT || 3000),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "/var/lib/tg-filehost/files"),
  maxFileMb: Number(process.env.MAX_FILE_MB || 2048),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
};

if (!Number.isFinite(cfg.apiId) || cfg.apiId <= 0) {
  throw new Error("API_ID must be a positive number");
}
if (!Number.isFinite(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
  throw new Error("PORT must be between 1 and 65535");
}
if (!Number.isFinite(cfg.maxFileMb) || cfg.maxFileMb <= 0) {
  throw new Error("MAX_FILE_MB must be a positive number");
}
if (cfg.allowedUsers.length === 0 && cfg.allowedChats.length === 0) {
  throw new Error("At least one of ALLOWED_USERS or ALLOWED_CHATS must be set");
}

module.exports = cfg;
