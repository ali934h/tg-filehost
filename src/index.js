/**
 * Entrypoint. Loads the persisted MTProto session (if any), starts the
 * GramJS client with the bot token, attaches handlers, brings up the
 * /health Express server, and kicks off the retention sweep.
 */

"use strict";

const fs = require("fs");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const config = require("./config");
const logger = require("./logger");
const fileManager = require("./fileManager");
const retention = require("./retention");
const { buildBot, setBotCommands } = require("./bot");
const server = require("./server");

let httpServer = null;
let tgClient = null;

function loadSession() {
  try {
    if (fs.existsSync(config.sessionFile)) {
      return fs.readFileSync(config.sessionFile, "utf8").trim();
    }
  } catch (err) {
    logger.warn("Failed to read session file", { error: err.message });
  }
  return "";
}

function persistSession(client) {
  try {
    const str = client.session.save();
    if (!str) return;
    fs.writeFileSync(config.sessionFile, str, { mode: 0o600 });
    fs.chmodSync(config.sessionFile, 0o600);
  } catch (err) {
    logger.warn("Failed to persist session", { error: err.message });
  }
}

async function main() {
  await fileManager.ensureRuntimeDirs();
  logger.info(
    `Storage ready: uploadDir=${config.uploadDir} tempDir=${config.tempDir}`
  );

  const session = new StringSession(loadSession());
  tgClient = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 10,
    autoReconnect: true,
  });
  tgClient.setLogLevel(config.logLevel === "debug" ? "info" : "error");

  logger.info("Connecting to Telegram...");
  await tgClient.start({ botAuthToken: config.botToken });
  persistSession(tgClient);

  let me;
  try {
    me = await tgClient.getMe();
    logger.info(
      `Logged in as @${me.username || me.firstName} (id=${me.id})`
    );
  } catch (err) {
    logger.warn("getMe() failed", { error: err.message });
  }

  if (config.allowedUsers.size === 0) {
    logger.warn(
      "ALLOWED_USERS is empty — bot is open to ANY Telegram user. Set ALLOWED_USERS in .env to restrict access."
    );
  } else {
    logger.info(`Allowed users: ${[...config.allowedUsers].join(", ")}`);
  }

  const bot = buildBot(tgClient);
  bot.attach();
  await setBotCommands(bot);

  const app = server.build();
  httpServer = await server.listen(app);

  retention.start();

  logger.info("tg-filehost is up.");
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  retention.stop();
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  if (tgClient) {
    try {
      await tgClient.disconnect();
    } catch (_e) {
      /* ignore */
    }
  }
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", {
    error: err && err.stack ? err.stack : String(err),
  });
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});

main().catch((err) => {
  logger.error("Fatal error during startup", {
    error: err && err.stack ? err.stack : String(err),
  });
  process.exit(1);
});
