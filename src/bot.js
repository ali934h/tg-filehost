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
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

let client;

/**
 * Channel posts: senderId is null (post is by the channel itself).
 * - If ALLOWED_CHATS is set: only allow messages from those chat IDs (handles both DM and channel)
 * - If ALLOWED_CHATS is empty: only allow messages from ALLOWED_USERS (DM/group)
 */
function isAllowed(senderId, chatId) {
  const chatIdStr = String(chatId);
  const senderIdStr = senderId ? String(senderId) : null;

  if (ALLOWED_CHATS.length > 0) {
    return ALLOWED_CHATS.includes(chatIdStr);
  }
  return senderIdStr ? ALLOWED_USERS.includes(senderIdStr) : false;
}

async function setupUserbot() {
  if (!SESSION) throw new Error('SESSION is empty. Please run: node src/login.js');

  client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 5,
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

  const text = msg.text || '';

  if (text === '/start') {
    await msg.reply({
      message:
        '👋 **Welcome to tg-filehost!**\n\n' +
        'Send any file here and I\'ll give you a direct CDN link.\n' +
        'Forwarded messages with files are also supported.\n\n' +
        '**Commands:**\n' +
        '/files — List all uploaded files\n' +
        '/storage — Storage usage\n' +
        '/deleteall — Delete all files\n' +
        '/chatid — Show this chat\'s ID'
    });
    return;
  }

  if (text === '/chatid') {
    await msg.reply({ message: `🔍 **Chat ID:** \`${chatId}\`` });
    return;
  }

  if (text === '/storage') {
    const { count, total } = await getTotalStorage();
    await msg.reply({ message: `📦 **Storage Usage**\n\nFiles: ${count}\nTotal size: ${total}` });
    return;
  }

  if (text === '/files') {
    const files = await listFiles();
    if (files.length === 0) { await msg.reply({ message: '📂 No files found.' }); return; }
    const lines = files.map((f, i) => {
      const date = new Date(f.uploadedAt).toLocaleString('en-GB');
      return `${i + 1}. **${f.originalName}**\n   💾 ${formatSize(f.size)} | 📅 ${date}\n   🔗 ${f.url}\n   🗑 /del_${f.id.split('-')[0]}`;
    });
    for (const chunk of chunkArray(lines, 10)) {
      await msg.reply({ message: chunk.join('\n\n') });
    }
    return;
  }

  if (text.startsWith('/del_')) {
    const shortId = text.replace('/del_', '').trim();
    const files = await listFiles();
    const file = files.find(f => f.id.startsWith(shortId));
    if (!file) { await msg.reply({ message: '❌ File not found.' }); return; }
    await deleteFile(file.id);
    await msg.reply({ message: `✅ Deleted: **${file.originalName}**` });
    return;
  }

  if (text === '/deleteall') {
    const count = await deleteAllFiles();
    await msg.reply({ message: `✅ Deleted ${count} file(s).` });
    return;
  }

  if (msg.media) {
    const processingReply = await msg.reply({ message: '⏳ Downloading file...' });
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
      await client.editMessage(msg.chatId, {
        message: processingReply,
        text:
          `✅ **File uploaded successfully!**\n\n` +
          `📄 ${entry.originalName}\n` +
          `💾 ${formatSize(entry.size)}\n\n` +
          `🔗 [Direct Link](${entry.url})`
      });
    } catch (err) {
      console.error('[Bot] Upload error:', err.message);
      try { await processingReply.edit({ text: '❌ Failed to download file. Please try again.' }); } catch (_) {}
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
