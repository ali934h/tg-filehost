"use strict";

const cfg = require("./config");
const logger = require("./logger");
const { startServer } = require("./server");
const { setupUserbot } = require("./bot");
const { ensureDirs } = require("./fileManager");

async function main() {
  logger.info(`Starting tg-filehost (host=${cfg.host}, uploadDir=${cfg.uploadDir})`);
  await ensureDirs();
  await startServer();
  await setupUserbot();
  logger.info("tg-filehost is running.");
}

main().catch((err) => {
  logger.error("Fatal error:", err && err.message ? err.message : err);
  process.exit(1);
});
