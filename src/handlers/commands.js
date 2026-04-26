/**
 * Plain command handlers (/start, /help, /storage, /chatid). The /files
 * browser lives in its own module because it juggles inline keyboards and
 * pagination state.
 */

"use strict";

const config = require("../config");
const filesStore = require("../files");
const fileManager = require("../fileManager");
const { escapeHtml } = require("../htmlEscape");

const HELP_TEXT =
  "<b>tg-filehost</b>\n\n" +
  "Send me a <b>file</b> (document, photo, video, audio) and I'll host it " +
  "and reply with a direct download link.\n\n" +
  "Send me a <b>direct URL</b> (e.g. a GitHub release asset) and I'll " +
  "download it and send it back as a Telegram file. URLs that return HTML " +
  "(YouTube, regular web pages, …) are rejected — use tg-video for those.\n\n" +
  "<b>Commands</b>\n" +
  "/start, /help — show this message\n" +
  "/files — list/manage hosted files\n" +
  "/storage — show how much disk is in use\n" +
  "/chatid — show your numeric Telegram id";

async function start(ctx) {
  await ctx.reply(HELP_TEXT, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function help(ctx) {
  await ctx.reply(HELP_TEXT, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

async function chatid(ctx) {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  await ctx.reply(
    `Your user id: <code>${escapeHtml(String(fromId))}</code>\n` +
      `Chat id: <code>${escapeHtml(String(chatId))}</code>`,
    { parse_mode: "HTML" }
  );
}

async function storage(ctx) {
  const { count, totalBytes } = await filesStore.totalStorage();
  const lines = [
    "<b>Storage</b>",
    `Files: <b>${count}</b>`,
    `Total: <b>${escapeHtml(fileManager.formatBytes(totalBytes))}</b>`,
  ];
  if (config.retentionDays > 0) {
    lines.push("");
    lines.push(
      `Retention: files older than <b>${config.retentionDays}</b> day(s) are auto-deleted.`
    );
  } else {
    lines.push("");
    lines.push("Retention: <b>disabled</b> (files kept forever).");
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

module.exports = { start, help, chatid, storage };
