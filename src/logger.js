"use strict";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function envLevel() {
  const lvl = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[lvl] != null ? LEVELS[lvl] : LEVELS.info;
}

function fmt(level, args) {
  const ts = new Date().toISOString();
  return [`[${ts}] ${level.toUpperCase().padEnd(5)}`, ...args];
}

function log(level, ...args) {
  if (LEVELS[level] > envLevel()) return;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(...fmt(level, args));
}

module.exports = {
  error: (...a) => log("error", ...a),
  warn: (...a) => log("warn", ...a),
  info: (...a) => log("info", ...a),
  debug: (...a) => log("debug", ...a),
};
