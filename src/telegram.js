"use strict";

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const cfg = require("./config");
const logger = require("./logger");

let client = null;

async function connect() {
  if (!cfg.session) {
    throw new Error(
      "SESSION is empty. Run `node setup.js` once to log in and write the session string to .env."
    );
  }

  client = new TelegramClient(new StringSession(cfg.session), cfg.apiId, cfg.apiHash, {
    connectionRetries: 5,
    retryDelay: 1000,
  });

  await client.connect();
  logger.info("Userbot connected.");
  return client;
}

function getClient() {
  if (!client) throw new Error("Telegram client not connected yet");
  return client;
}

function onNewMessage(handler) {
  getClient().addEventHandler(handler, new NewMessage({}));
}

async function disconnect() {
  if (!client) return;
  try {
    await client.disconnect();
  } catch (err) {
    logger.warn("Disconnect error:", err.message);
  }
  client = null;
}

module.exports = { connect, getClient, onNewMessage, disconnect };
