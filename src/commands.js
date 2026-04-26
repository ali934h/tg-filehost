"use strict";

const path = require("path");
const fs = require("fs-extra");
const cfg = require("./config");
const logger = require("./logger");
const fm = require("./fileManager");
const tg = require("./telegram");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HELP_TEXT =
  "📌 <b>tg-filehost — Help</b>\n\n" +
  "Send any file to this chat and the bot will store it on the server and " +
  "return a direct download link.\n\n" +
  "<b>📂 File management</b>\n" +
  "/files — List uploaded files with links\n" +
  "/storage — Show total storage usage\n" +
  "/del_&lt;id&gt; — Delete a specific file (id shown in /files)\n" +
  "/deleteall — Delete all files\n\n" +
  "<b>ℹ️ Other</b>\n" +
  "/chatid — Show this chat's ID\n" +
  "/help — Show this message\n\n" +
  "<b>📎 How it works</b>\n" +
  "1. Send or forward any file here\n" +
  "2. Bot replies with ⏳ Downloading file...\n" +
  "3. You get a direct link you can copy or share.\n\n" +
  "<i>Anyone with the link can download the file. Treat links as secret.</i>";

function isAllowed(senderId, chatId) {
  const chatIdStr = chatId != null ? String(chatId) : null;
  const senderIdStr = senderId != null ? String(senderId) : null;
  if (cfg.allowedChats.length > 0 && chatIdStr) {
    return cfg.allowedChats.includes(chatIdStr);
  }
  if (cfg.allowedUsers.length > 0 && senderIdStr) {
    return cfg.allowedUsers.includes(senderIdStr);
  }
  return false;
}

async function sendReply(msg, text) {
  return tg.getClient().sendMessage(msg.chatId, {
    message: text,
    replyTo: msg.id,
    linkPreview: false,
    parseMode: "html",
  });
}

async function editOrSend(chatId, sentMsg, text) {
  try {
    await tg.getClient().editMessage(chatId, {
      message: sentMsg,
      text,
      linkPreview: false,
      parseMode: "html",
    });
  } catch (e) {
    await tg.getClient().sendMessage(chatId, {
      message: text,
      linkPreview: false,
      parseMode: "html",
    });
  }
}

function buildUrl(fileName) {
  return `https://${cfg.host}/files/${fileName}`;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function extractFileInfo(msg) {
  const ts = Date.now();
  const media = msg.media;
  if (media && media.document) {
    const doc = media.document;
    const nameAttr = (doc.attributes || []).find(
      (a) => a.className === "DocumentAttributeFilename"
    );
    if (nameAttr && nameAttr.fileName) {
      return { name: nameAttr.fileName, mime: doc.mimeType || "application/octet-stream" };
    }
    // Fall back to type-specific defaults if no filename attribute
    const videoAttr = (doc.attributes || []).find(
      (a) => a.className === "DocumentAttributeVideo"
    );
    if (videoAttr) return { name: `video_${ts}.mp4`, mime: doc.mimeType || "video/mp4" };
    const audioAttr = (doc.attributes || []).find(
      (a) => a.className === "DocumentAttributeAudio"
    );
    if (audioAttr) return { name: `audio_${ts}.mp3`, mime: doc.mimeType || "audio/mpeg" };
    return { name: `file_${ts}`, mime: doc.mimeType || "application/octet-stream" };
  }
  if (media && media.photo) return { name: `photo_${ts}.jpg`, mime: "image/jpeg" };
  return { name: `file_${ts}`, mime: "application/octet-stream" };
}

function getMediaSize(msg) {
  const media = msg.media;
  if (media && media.document && media.document.size) {
    return Number(media.document.size);
  }
  return 0;
}

// Returns true only for media types we can actually stream to disk.
// Skips link previews (MessageMediaWebPage), polls, contacts, geo, etc.
function isDownloadableMedia(media) {
  if (!media) return false;
  const cn = media.className;
  return cn === "MessageMediaDocument" || cn === "MessageMediaPhoto";
}

async function handleHelp(msg) {
  await sendReply(msg, HELP_TEXT);
}

async function handleChatId(msg, chatId) {
  await sendReply(msg, `🔍 <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>`);
}

async function handleStorage(msg) {
  const { count, total } = await fm.getTotalStorage();
  await sendReply(
    msg,
    `📦 <b>Storage usage</b>\n\nFiles: ${count}\nTotal size: ${escapeHtml(total)}`
  );
}

async function handleFiles(msg) {
  const files = await fm.listFiles();
  if (files.length === 0) {
    await sendReply(msg, "📂 No files found.");
    return;
  }
  const lines = files.map((f, i) => {
    const date = new Date(f.uploadedAt).toLocaleString("en-GB");
    return (
      `${i + 1}. <b>${escapeHtml(f.originalName)}</b>\n` +
      `   💾 ${escapeHtml(fm.formatSize(f.size))} | 📅 ${escapeHtml(date)}\n` +
      `   🔗 <code>${escapeHtml(f.url)}</code>\n` +
      `   🗑 /del_${f.id.split("-")[0]}`
    );
  });
  for (const chunk of chunkArray(lines, 10)) {
    await sendReply(msg, chunk.join("\n\n"));
  }
}

async function handleDelete(msg, text) {
  const shortId = text.replace("/del_", "").trim();
  if (!shortId) {
    await sendReply(msg, "❌ Usage: /del_&lt;id&gt;");
    return;
  }
  const result = await fm.findByShortId(shortId);
  if (result.ambiguous) {
    await sendReply(
      msg,
      `❌ Ambiguous id <code>${escapeHtml(shortId)}</code>. Use a longer prefix.`
    );
    return;
  }
  if (!result.match) {
    await sendReply(msg, "❌ File not found.");
    return;
  }
  await fm.deleteFile(result.match.id);
  await sendReply(msg, `✅ Deleted: <b>${escapeHtml(result.match.originalName)}</b>`);
}

async function handleDeleteAll(msg) {
  const count = await fm.deleteAllFiles();
  await sendReply(msg, `✅ Deleted ${count} file(s).`);
}

async function handleUpload(msg) {
  const sizeBytes = getMediaSize(msg);
  const maxBytes = cfg.maxFileMb * 1024 * 1024;
  if (sizeBytes > 0 && sizeBytes > maxBytes) {
    await sendReply(
      msg,
      `❌ File too large (${escapeHtml(fm.formatSize(sizeBytes))}). ` +
        `Max allowed: ${cfg.maxFileMb} MB.`
    );
    return;
  }

  const processingMsg = await sendReply(msg, "⏳ Downloading file...");
  try {
    const fileInfo = extractFileInfo(msg);
    const { id, fileName, filePath } = await fm.saveFileStream(
      tg.getClient(),
      msg,
      fileInfo.name
    );
    const stat = await fs.stat(filePath);
    const entry = {
      id,
      originalName: fileInfo.name,
      fileName,
      mimeType: fileInfo.mime,
      size: stat.size,
      uploadedAt: new Date().toISOString(),
      url: buildUrl(fileName),
    };
    await fm.appendMeta(entry);

    const successText =
      `✅ <b>${escapeHtml(entry.originalName)}</b>\n` +
      `💾 ${escapeHtml(fm.formatSize(entry.size))}\n\n` +
      `<code>${escapeHtml(entry.url)}</code>`;

    await editOrSend(msg.chatId, processingMsg, successText);
  } catch (err) {
    logger.error("Upload error:", err.message);
    try {
      await editOrSend(
        msg.chatId,
        processingMsg,
        "❌ Failed to download file. Please try again."
      );
    } catch (_) {}
  }
}

async function handleMessage(event) {
  const msg = event.message;
  const senderId = msg.senderId ? msg.senderId.toString() : null;
  const chatId = msg.chatId ? msg.chatId.toString() : null;

  if (!chatId || !isAllowed(senderId, chatId)) return;

  const text = (msg.text || "").trim();

  if (text === "/start" || text === "/help") return handleHelp(msg);
  if (text === "/chatid") return handleChatId(msg, chatId);
  if (text === "/storage") return handleStorage(msg);
  if (text === "/files") return handleFiles(msg);
  if (text.startsWith("/del_")) return handleDelete(msg, text);
  if (text === "/deleteall") return handleDeleteAll(msg);
  if (isDownloadableMedia(msg.media)) return handleUpload(msg);
  if (msg.media) {
    await sendReply(
      msg,
      "❌ Please send an actual file. Links, polls, and plain text messages can't be hosted."
    );
  }
}

module.exports = { handleMessage };
