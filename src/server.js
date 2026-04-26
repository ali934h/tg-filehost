/**
 * Minimal Express server. The bot itself talks MTProto directly to Telegram
 * (no webhook), so this server only exposes /health for nginx upstream
 * checks. Static file downloads are served by nginx straight from disk and
 * never hit Node.
 */

"use strict";

const express = require("express");
const config = require("./config");
const logger = require("./logger");

function build() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.nodeEnv,
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  app.use((err, _req, res, _next) => {
    logger.error("Express error", { error: err.message });
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(config.serverPort, config.serverHost, () => {
      logger.info(
        `HTTP server listening on ${config.serverHost}:${config.serverPort}`
      );
      resolve(srv);
    });
    srv.once("error", reject);
  });
}

module.exports = { build, listen };
