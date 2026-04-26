/**
 * Telegram file → direct download link.
 *
 * Triggered when an allowed user sends a media message (document, photo,
 * video, audio, …) to the bot. The file is streamed to UPLOAD_DIR via
 * GramJS iterDownload, a sidecar metadata JSON is written, and the user
 * receives the direct https://<HOST>/files/<name> URL.
 */

"use strict";

const path = require("path");
const fsp = require("fs").promises;

const config = require("../config");
const logger = require("../logger");
const fileManager = require("../fileManager");
const filesStore = require("../files");
const { escapeHtml } = require("../htmlEscape");

const DOWNLOADABLE = new Set(["MessageMediaDocument", "MessageMediaPhoto"]);

function isDownloadableMedia(media) {
  return Boolean(media && DOWNLOADABLE.has(media.className));
}

function extractFileInfo(msg) {
  const ts = Date.now();
  const media = msg.media;
  if (media && media.document) {
    const doc = media.document;
    const attrs = doc.attributes || [];
    const nameAttr = attrs.find(
      (a) => a.className === "DocumentAttributeFilename"
    );
    if (nameAttr && nameAttr.fileName) {
      return {
        name: nameAttr.fileName,
        mime: doc.mimeType || "application/octet-stream",
      };
    }
    if (attrs.find((a) => a.className === "DocumentAttributeVideo")) {
      return { name: `video_${ts}.mp4`, mime: doc.mimeType || "video/mp4" };
    }
    if (attrs.find((a) => a.className === "DocumentAttributeAudio")) {
      return { name: `audio_${ts}.mp3`, mime: doc.mimeType || "audio/mpeg" };
    }
    if (attrs.find((a) => a.className === "DocumentAttributeSticker")) {
      return { name: `sticker_${ts}.webp`, mime: doc.mimeType || "image/webp" };
    }
    if (attrs.find((a) => a.className === "DocumentAttributeAnimated")) {
      return { name: `animation_${ts}.gif`, mime: doc.mimeType || "image/gif" };
    }
    return {
      name: `file_${ts}`,
      mime: doc.mimeType || "application/octet-stream",
    };
  }
  if (media && media.photo) {
    return { name: `photo_${ts}.jpg`, mime: "image/jpeg" };
  }
  return { name: `file_${ts}`, mime: "application/octet-stream" };
}

function getMediaSize(msg) {
  const media = msg.media;
  if (media && media.document && media.document.size) {
    return Number(media.document.size);
  }
  return 0;
}

async function handle(ctx) {
  const msg = ctx.message?.raw;
  if (!msg || !isDownloadableMedia(msg.media)) {
    await ctx.reply(
      "❌ Please send an actual file (document, photo, video, audio).\n" +
        "Plain text, polls and contacts can't be hosted."
    );
    return;
  }

  const sizeBytes = getMediaSize(msg);
  const maxBytes = config.maxFileMb * 1024 * 1024;
  if (sizeBytes > 0 && sizeBytes > maxBytes) {
    await ctx.reply(
      `❌ File too large (${escapeHtml(
        fileManager.formatBytes(sizeBytes)
      )}). Max allowed: ${config.maxFileMb} MB.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const status = await ctx.reply("⏳ Downloading file...");
  let saved = null;
  try {
    const fileInfo = extractFileInfo(msg);
    saved = await fileManager.saveTelegramMediaStream(
      ctx.client,
      msg,
      fileInfo.name
    );

    let actualSize = sizeBytes;
    try {
      const stat = await fsp.stat(saved.filePath);
      actualSize = stat.size;
    } catch (_e) {
      // fall back to media-declared size
    }

    const entry = {
      id: saved.id,
      originalName: fileInfo.name,
      fileName: saved.fileName,
      size: actualSize,
      uploadedAt: new Date().toISOString(),
      uploaderUserId: ctx.from?.id ?? null,
      url: filesStore.buildPublicUrl(saved.fileName),
    };
    await filesStore.appendMeta(entry);

    const successText =
      `✅ <b>${escapeHtml(entry.originalName)}</b>\n` +
      `💾 ${escapeHtml(fileManager.formatBytes(entry.size))}\n\n` +
      `<code>${escapeHtml(entry.url)}</code>`;

    await ctx.telegram
      .editMessageText(ctx.chat.id, status.message_id, null, successText, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      })
      .catch(() => {});
  } catch (err) {
    logger.error("Upload error", { error: err.message });
    if (saved) {
      await fileManager.deletePath(saved.filePath);
      await filesStore.deleteMeta(saved.fileName);
    }
    await ctx.telegram
      .editMessageText(
        ctx.chat.id,
        status.message_id,
        null,
        "❌ Failed to download file. Please try again."
      )
      .catch(() => {});
  }
}

module.exports = { handle, isDownloadableMedia };
