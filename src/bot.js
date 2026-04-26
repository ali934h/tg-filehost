/**
 * Bot wiring. Registers commands, the inline /files browser, and the two
 * primary message handlers (media → host, text URL → fetch).
 */

"use strict";

const config = require("./config");
const logger = require("./logger");
const { BotAdapter } = require("./tg/adapter");
const commands = require("./handlers/commands");
const filesHandler = require("./handlers/files");
const upload = require("./handlers/upload");
const urlDownload = require("./handlers/urlDownload");

function isAllowed(userId) {
  if (config.allowedUsers.size === 0) return true;
  return config.allowedUsers.has(Number(userId));
}

function buildBot(client) {
  const bot = new BotAdapter(client);

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!isAllowed(userId)) {
      logger.warn(`Rejected unauthorized user ${userId}`);
      try {
        await ctx.reply(
          "⛔ Sorry, you are not authorized to use this bot."
        );
      } catch (_e) {
        /* ignore */
      }
      return;
    }
    await next();
  });

  bot.command("start", commands.start);
  bot.command("help", commands.help);
  bot.command("chatid", commands.chatid);
  bot.command("storage", commands.storage);
  bot.command("files", async (ctx) => {
    await filesHandler.showFilesList(ctx, 0);
  });

  filesHandler.register(bot);

  bot.on("media", upload.handle);
  bot.on("text", urlDownload.handle);

  bot.catch(async (err, ctx) => {
    logger.error("Bot handler error", {
      error: err && err.stack ? err.stack : String(err),
    });
    try {
      await ctx.reply("❌ Something went wrong. Please try again.");
    } catch (_e) {
      /* ignore */
    }
  });

  return bot;
}

async function setBotCommands(bot) {
  try {
    await bot.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "help", description: "Show usage instructions" },
      { command: "files", description: "List/manage hosted files" },
      { command: "storage", description: "Show disk usage" },
      { command: "chatid", description: "Show your Telegram id" },
    ]);
    logger.info("Bot commands registered");
  } catch (err) {
    logger.warn("Failed to register bot commands", { error: err.message });
  }
}

module.exports = { buildBot, setBotCommands };
