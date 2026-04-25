"use strict";

const tg = require("./telegram");
const logger = require("./logger");
const { handleMessage } = require("./commands");

async function setupUserbot() {
  await tg.connect();
  tg.onNewMessage(handleMessage);
  logger.info("Bot ready, listening for messages.");
}

module.exports = { setupUserbot };
