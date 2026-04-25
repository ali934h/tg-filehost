"use strict";

const express = require("express");
const cfg = require("./config");
const logger = require("./logger");

function buildApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // 404 for everything else. File serving is handled by nginx via the
  // /files/ alias on the upload directory; the app does not serve files.
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

function startServer() {
  const app = buildApp();
  return new Promise((resolve) => {
    const server = app.listen(cfg.port, "127.0.0.1", () => {
      logger.info(`HTTP server listening on 127.0.0.1:${cfg.port}`);
      resolve(server);
    });
  });
}

module.exports = { buildApp, startServer };
