/**
 * Inline-keyboard handlers for the /files browser:
 *   list → details → delete + bulk delete.
 *
 * Lists are rebuilt on every callback so concurrent uploads / retention
 * deletions don't desync the on-screen indices.
 */

"use strict";

const { Markup } = require("../tg/markup");
const logger = require("../logger");
const filesStore = require("../files");
const fileManager = require("../fileManager");
const { escapeHtml } = require("../htmlEscape");

const PAGE_SIZE = 10;

function pageOf(idx) {
  return Math.floor(idx / PAGE_SIZE);
}

async function buildFilesListMessage(page = 0) {
  const files = await filesStore.listFiles();
  if (files.length === 0) {
    return { text: "No hosted files.", keyboard: null };
  }
  const totalSize = fileManager.formatBytes(
    files.reduce((sum, f) => sum + (f.size || 0), 0)
  );
  const totalPages = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const slice = files.slice(start, start + PAGE_SIZE);

  const text =
    `🗂 Hosted files: <b>${files.length}</b> total (${escapeHtml(totalSize)})` +
    (totalPages > 1 ? `\nPage ${safePage + 1}/${totalPages}` : "");

  const buttons = slice.map((f, i) => {
    const idx = start + i;
    const display = (f.originalName || f.fileName).slice(0, 40);
    return [Markup.button.callback(`📂 ${idx + 1}. ${display}`, `fi:${idx}`)];
  });

  const navRow = [];
  if (safePage > 0) {
    navRow.push(Markup.button.callback("⬅️ Prev", `pg:${safePage - 1}`));
  }
  if (safePage < totalPages - 1) {
    navRow.push(Markup.button.callback("Next ➡️", `pg:${safePage + 1}`));
  }
  if (navRow.length > 0) buttons.push(navRow);

  buttons.push([Markup.button.callback("⚙️ Manage All", "manage_all")]);
  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

async function showFilesList(ctx, page = 0) {
  const { text, keyboard } = await buildFilesListMessage(page);
  const opts = { parse_mode: "HTML", disable_web_page_preview: true };
  if (keyboard) Object.assign(opts, keyboard);
  await ctx.reply(text, opts);
}

async function refreshList(ctx, page = 0) {
  const { text, keyboard } = await buildFilesListMessage(page);
  const opts = { parse_mode: "HTML", disable_web_page_preview: true };
  if (keyboard) Object.assign(opts, keyboard);
  await ctx.editMessageText(text, opts).catch(() => {});
}

async function showFileDetails(ctx, idx) {
  const files = await filesStore.listFiles();
  if (idx < 0 || idx >= files.length) {
    await ctx.answerCbQuery("File not found.");
    await refreshList(ctx, 0);
    return;
  }
  const f = files[idx];
  const size = fileManager.formatBytes(f.size || 0);
  const date = (f.uploadedAt || "").slice(0, 16).replace("T", " ");
  const url = f.url || filesStore.buildPublicUrl(f.fileName);

  const lines = [
    "📂 <b>File Details</b>",
    "",
    `Name: <code>${escapeHtml(f.originalName || f.fileName)}</code>`,
    `Size: ${escapeHtml(size)}`,
    `Date: ${escapeHtml(date)}`,
    "",
    "Link:",
    `<code>${escapeHtml(url)}</code>`,
  ];

  await ctx.answerCbQuery();
  await ctx
    .editMessageText(lines.join("\n"), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🗑 Delete This File", `cd:${idx}`)],
        [Markup.button.callback("⬅️ Back to List", `pg:${pageOf(idx)}`)],
      ]),
    })
    .catch(() => {});
}

async function confirmDelete(ctx, idx) {
  const files = await filesStore.listFiles();
  if (idx < 0 || idx >= files.length) {
    await ctx.answerCbQuery("File not found.");
    return;
  }
  const f = files[idx];
  await ctx.answerCbQuery();
  await ctx
    .editMessageText(
      `⚠️ Delete <b>${escapeHtml(f.originalName || f.fileName)}</b>?`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Yes, delete", `dd:${idx}`)],
          [Markup.button.callback("❌ Cancel", `fi:${idx}`)],
        ]),
      }
    )
    .catch(() => {});
}

async function doDelete(ctx, idx) {
  const files = await filesStore.listFiles();
  if (idx < 0 || idx >= files.length) {
    await ctx.answerCbQuery("File not found.");
    return;
  }
  const f = files[idx];
  const ok = await filesStore.deleteById(f.id);
  if (ok) {
    logger.info(`File deleted by user ${ctx.from?.id}: ${f.fileName}`);
    await ctx.answerCbQuery("Deleted.");
  } else {
    await ctx.answerCbQuery("Failed to delete.");
  }
  const remaining = await filesStore.listFiles();
  if (remaining.length === 0) {
    await ctx.editMessageText("✅ Deleted. No more files.").catch(() => {});
  } else {
    await refreshList(ctx, pageOf(Math.min(idx, remaining.length - 1)));
  }
}

async function manageAll(ctx) {
  const { count, totalBytes } = await filesStore.totalStorage();
  await ctx.answerCbQuery();
  await ctx
    .editMessageText(
      `⚙️ <b>Manage All</b>\n\nTotal: ${count} file(s), ${escapeHtml(
        fileManager.formatBytes(totalBytes)
      )}\n\nDeleting all hosted files cannot be undone.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🗑 Delete ALL", "confirm_del_all")],
          [Markup.button.callback("⬅️ Back", "pg:0")],
        ]),
      }
    )
    .catch(() => {});
}

async function confirmDeleteAll(ctx) {
  const { count } = await filesStore.totalStorage();
  await ctx.answerCbQuery();
  await ctx
    .editMessageText(
      `⚠️ Delete <b>${count}</b> file(s)? This cannot be undone.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Yes, delete all", "do_del_all")],
          [Markup.button.callback("❌ Cancel", "manage_all")],
        ]),
      }
    )
    .catch(() => {});
}

async function doDeleteAll(ctx) {
  const removed = await filesStore.deleteAll();
  logger.info(`Bulk delete by user ${ctx.from?.id}: ${removed} file(s)`);
  await ctx.answerCbQuery(`Deleted ${removed} file(s).`);
  await ctx
    .editMessageText(`✅ Deleted ${removed} file(s).`)
    .catch(() => {});
}

function register(bot) {
  bot.action(/^pg:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await refreshList(ctx, parseInt(ctx.match[1], 10));
  });
  bot.action(/^fi:(\d+)$/, async (ctx) => {
    await showFileDetails(ctx, parseInt(ctx.match[1], 10));
  });
  bot.action(/^cd:(\d+)$/, async (ctx) => {
    await confirmDelete(ctx, parseInt(ctx.match[1], 10));
  });
  bot.action(/^dd:(\d+)$/, async (ctx) => {
    await doDelete(ctx, parseInt(ctx.match[1], 10));
  });
  bot.action("manage_all", manageAll);
  bot.action("confirm_del_all", confirmDeleteAll);
  bot.action("do_del_all", doDeleteAll);
}

module.exports = { register, showFilesList };
