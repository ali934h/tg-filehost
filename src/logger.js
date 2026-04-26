/**
 * Logger with timestamp + LOG_LEVEL gating.
 */

"use strict";

const config = require("./config");

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[config.logLevel] ?? LEVELS.info;

function format(level, message, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (!meta || (typeof meta === "object" && Object.keys(meta).length === 0)) {
    return base;
  }
  try {
    return `${base} ${JSON.stringify(meta)}`;
  } catch {
    return `${base} ${String(meta)}`;
  }
}

const logger = {
  error(msg, meta) {
    if (currentLevel >= 0) console.error(format("error", msg, meta));
  },
  warn(msg, meta) {
    if (currentLevel >= 1) console.warn(format("warn", msg, meta));
  },
  info(msg, meta) {
    if (currentLevel >= 2) console.log(format("info", msg, meta));
  },
  debug(msg, meta) {
    if (currentLevel >= 3) console.log(format("debug", msg, meta));
  },
};

module.exports = logger;
