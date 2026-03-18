const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { saveFileStream, listFiles, deleteFile, deleteAllFiles, getTotalStorage, formatSize, appendMeta } = require('./fileManager');
const path = require('path');
const fs = require('fs-extra');

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const SESSION = process.env.SESSION || '';
const ALLOWED_USERS = process.env.ALLOWED_USERS
  ? process.env.ALLOWED_USERS.split(',').map(id => id.trim())
  : [];
const ALLOWED_CHATS = process.env.ALLOWED_CHATS
  ? process.env.ALLOWED_CHATS.split(',').map(id => id.trim())
  : [];
const FILES_SUBDOMAIN = process.env.FILES_SUBDOMAIN || 'files';
const DOMAIN = process.env.DOMAIN;

let client;

function isAllowed(senderId, chatId) {
  const chatIdStr = String(chatId);
  const senderIdStr = senderId ? String(senderId) : null;
  if (ALLOWED_CHATS.length > 0) return ALLOWED_CHATS.includes(chatIdStr);
  return senderIdStr ? ALLOWED_USERS.includes(senderIdStr) : false;
}

/**
 * Send a reply. In channels, msg.reply() uses editMessage internally which
 * can fail with MESSAGE_NOT_MODIFIED. We use client.sendMessage directly.
 */
async function sendReply(msg, text) {
  return await client.sendMessage(msg.chatId, {
    message: text,
    replyTo: msg.id,
  });
}

/**
 * Edit a previously sent message safely.
 * Falls back to sending a new message if edit fails.
 */
async function editOrSend(chatId, sentMsg, text) {
  try {
    await client.editMessage(chatId, { message: sentMsg, text });
  } catch (e) {
    // MESSAGE_NOT_MODIFIED or edit not allowed in channel
    await client.sendMessage(chatId, { message: text });
  }
}

async function setupUserbot() {
  if (!SESSION) throw new Error('SESSION is empty. Please run: node src/login.js');

  client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 5,
    retryDelay: 1000,
  });

  await client.connect();
  console.log('[Bot] Userbot connected.');
  client.addEventHandler(handleMessage, new NewMessage({}));
  console.log('[Bot] Ready.');
}

async function handleMessage(event) {
  const msg = event.message;
  const senderId = msg.senderId ? msg.senderId.toString() : null;
  const chatId = msg.chatId ? msg.chatId.toString() : null;

  if (!chatId || !isAllowed(senderId, chatId)) return;

  const text = (msg.text || '').trim();

  if (text === '/start') {
    await sendReply(msg,
      '\u{1F44B} **Welcome to tg-filehost!**\n\n' +
      'Send any file here and I\'ll give you a direct CDN link.\n\n' +
      '**Commands:**\n' +
      '/files \u2014 List all uploaded files\n' +
      '/storage \u2014 Storage usage\n' +
      '/deleteall \u2014 Delete all files\n' +
      '/chatid \u2014 Show this chat\'s ID'
    );
    return;
  }

  if (text === '/chatid') {
    await sendReply(msg, `\u{1F50D} **Chat ID:** \`${chatId}\``);
    return;
  }

  if (text === '/storage') {
    const { count, total } = await getTotalStorage();
    await sendReply(msg, `\u{1F4E6} **Storage Usage**\n\nFiles: ${count}\nTotal size: ${total}`);
    return;
  }

  if (text === '/files') {
    const files = await listFiles();
    if (files.length === 0) { await sendReply(msg, '\u{1F4C2} No files found.'); return; }
    const lines = files.map((f, i) => {
      const date = new Date(f.uploadedAt).toLocaleString('en-GB');
      return `${i + 1}. **${f.originalName}**\n   \u{1F4BE} ${formatSize(f.size)} | \u{1F4C5} ${date}\n   \u{1F517} ${f.url}\n   \u{1F5D1} /del_${f.id.split('-')[0]}`;
    });
    for (const chunk of chunkArray(lines, 10)) {
      await sendReply(msg, chunk.join('\n\n'));
    }
    return;
  }

  if (text.startsWith('/del_')) {
    const shortId = text.replace('/del_', '').trim();
    const files = await listFiles();
    const file = files.find(f => f.id.startsWith(shortId));
    if (!file) { await sendReply(msg, '\u274C File not found.'); return; }
    await deleteFile(file.id);
    await sendReply(msg, `\u2705 Deleted: **${file.originalName}**`);
    return;
  }

  if (text === '/deleteall') {
    const count = await deleteAllFiles();
    await sendReply(msg, `\u2705 Deleted ${count} file(s).`);
    return;
  }

  if (msg.media) {
    const processingMsg = await sendReply(msg, '\u23F3 Downloading file...');
    try {
      const fileInfo = extractFileInfo(msg);
      const { uuid, filePath } = await saveFileStream(client, msg, fileInfo.name, fileInfo.mime);
      const stat = await fs.stat(filePath);
      const entry = {
        id: uuid,
        originalName: fileInfo.name,
        fileName: path.basename(filePath),
        mimeType: fileInfo.mime,
        size: stat.size,
        uploadedAt: new Date().toISOString(),
        url: `https://${FILES_SUBDOMAIN}.${DOMAIN}/files/${path.basename(filePath)}`
      };
      await appendMeta(entry);

      const successText =
        `\u2705 **File uploaded successfully!**\n\n` +
        `\u{1F4C4} ${entry.originalName}\n` +
        `\u{1F4BE} ${formatSize(entry.size)}\n\n` +
        `\u{1F517} [Direct Link](${entry.url})`;

      await editOrSend(msg.chatId, processingMsg, successText);
    } catch (err) {
      console.error('[Bot] Upload error:', err.message);
      try {
        await editOrSend(msg.chatId, processingMsg, '\u274C Failed to download file. Please try again.');
      } catch (_) {}
    }
  }
}

function extractFileInfo(msg) {
  const media = msg.media;
  const ts = Date.now();
  if (media.document) {
    const doc = media.document;
    const nameAttr = doc.attributes?.find(a => a.className === 'DocumentAttributeFilename');
    return { name: nameAttr?.fileName || `file_${ts}`, mime: doc.mimeType || 'application/octet-stream' };
  }
  if (media.photo) return { name: `photo_${ts}.jpg`, mime: 'image/jpeg' };
  if (media.video) return { name: `video_${ts}.mp4`, mime: 'video/mp4' };
  if (media.audio) return { name: `audio_${ts}.mp3`, mime: 'audio/mpeg' };
  return { name: `file_${ts}`, mime: 'application/octet-stream' };
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { setupUserbot };
