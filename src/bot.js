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
const HOST = process.env.HOST;

let client;

const HELP_TEXT =
  '\u{1F4CC} **tg-filehost \u2014 Help**\n\n' +
  'Send any file to this chat and the bot will upload it and return a direct CDN link.\n\n' +
  '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
  '\u{1F5C2} **File Management**\n' +
  '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
  '`/files` \u2014 List all uploaded files with links\n' +
  '`/storage` \u2014 Show total storage usage\n' +
  '`/del_<id>` \u2014 Delete a specific file (ID shown in /files)\n' +
  '`/deleteall` \u2014 Delete all files\n\n' +
  '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
  '\u2139\ufe0f **Other**\n' +
  '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
  '`/chatid` \u2014 Show this chat\'s ID\n' +
  '`/help` \u2014 Show this message\n\n' +
  '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
  '\u{1F4CE} **How it works**\n' +
  '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
  '1. Send or forward any file here\n' +
  '2. Bot replies with \u23f3 Downloading file...\n' +
  '3. Once done, you get a direct link you can tap to copy instantly.';

function isAllowed(senderId, chatId) {
  const chatIdStr = String(chatId);
  const senderIdStr = senderId ? String(senderId) : null;
  if (ALLOWED_CHATS.length > 0) return ALLOWED_CHATS.includes(chatIdStr);
  return senderIdStr ? ALLOWED_USERS.includes(senderIdStr) : false;
}

async function sendReply(msg, text) {
  return await client.sendMessage(msg.chatId, {
    message: text,
    replyTo: msg.id,
    linkPreview: false,
  });
}

async function editOrSend(chatId, sentMsg, text) {
  try {
    await client.editMessage(chatId, { message: sentMsg, text, linkPreview: false });
  } catch (e) {
    await client.sendMessage(chatId, { message: text, linkPreview: false });
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

  if (text === '/start' || text === '/help') {
    await sendReply(msg, HELP_TEXT);
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
      return `${i + 1}. **${f.originalName}**\n   \u{1F4BE} ${formatSize(f.size)} | \u{1F4C5} ${date}\n   \u{1F517} \`${f.url}\`\n   \u{1F5D1} /del_${f.id.split('-')[0]}`;
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
        url: `https://${HOST}/files/${path.basename(filePath)}`
      };
      await appendMeta(entry);

      const successText =
        `\u2705 **${entry.originalName}**\n` +
        `\u{1F4BE} ${formatSize(entry.size)}\n\n` +
        `\`${entry.url}\``;

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
