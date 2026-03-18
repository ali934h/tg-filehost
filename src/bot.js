const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const path = require('path');
const fs = require('fs-extra');
const { saveFile, listFiles, deleteFile, deleteAllFiles, getTotalStorage, formatSize } = require('./fileManager');

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const PHONE = process.env.PHONE;
const SESSION = process.env.SESSION || '';
const ALLOWED_USERS = process.env.ALLOWED_USERS
  ? process.env.ALLOWED_USERS.split(',').map(id => parseInt(id.trim()))
  : [];
const FILES_SUBDOMAIN = process.env.FILES_SUBDOMAIN || 'files';
const DOMAIN = process.env.DOMAIN;

let client;

function isAllowed(senderId) {
  return ALLOWED_USERS.includes(Number(senderId));
}

async function setupUserbot() {
  const session = new StringSession(SESSION);
  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: false
  });

  await client.start({
    phoneNumber: PHONE,
    onError: (err) => console.error('[Bot] Auth error:', err),
  });

  const savedSession = client.session.save();
  if (savedSession !== SESSION) {
    console.log('[Bot] New session generated. Saving to .env...');
    const envPath = path.resolve('.env');
    let envContent = await fs.readFile(envPath, 'utf8');
    if (envContent.includes('SESSION=')) {
      envContent = envContent.replace(/^SESSION=.*$/m, `SESSION=${savedSession}`);
    } else {
      envContent += `\nSESSION=${savedSession}`;
    }
    await fs.writeFile(envPath, envContent);
  }

  console.log('[Bot] Userbot connected.');

  client.addEventHandler(handleMessage, new NewMessage({}));

  console.log('[Bot] Ready.');
}

async function handleMessage(event) {
  const msg = event.message;
  const senderId = msg.senderId ? msg.senderId.toString() : null;

  if (!senderId || !isAllowed(senderId)) return;

  const text = msg.text || '';

  // /start
  if (text === '/start') {
    await msg.reply({
      message:
        '👋 **Welcome to tg-filehost!**\n\n' +
        'Send me any file and I\'ll give you a direct CDN link.\n' +
        'Forwarded messages with files are also supported.\n\n' +
        '**Commands:**\n' +
        '/files — List all files\n' +
        '/storage — Storage usage\n' +
        '/deleteall — Delete all files'
    });
    return;
  }

  // /storage
  if (text === '/storage') {
    const { count, total } = await getTotalStorage();
    await msg.reply({ message: `📦 **Storage Usage**\n\nFiles: ${count}\nTotal size: ${total}` });
    return;
  }

  // /files
  if (text === '/files') {
    const files = await listFiles();
    if (files.length === 0) {
      await msg.reply({ message: '📂 No files found.' });
      return;
    }
    const lines = files.map((f, i) => {
      const date = new Date(f.uploadedAt).toLocaleString('en-GB');
      return `${i + 1}. **${f.originalName}**\n   💾 ${formatSize(f.size)} | 📅 ${date}\n   🔗 ${f.url}\n   🗑 /del_${f.id.split('-')[0]}`;
    });
    const chunks = chunkArray(lines, 10);
    for (const chunk of chunks) {
      await msg.reply({ message: chunk.join('\n\n') });
    }
    return;
  }

  // /del_<shortid>
  if (text.startsWith('/del_')) {
    const shortId = text.replace('/del_', '').trim();
    const files = await listFiles();
    const file = files.find(f => f.id.startsWith(shortId));
    if (!file) {
      await msg.reply({ message: '❌ File not found.' });
      return;
    }
    await deleteFile(file.id);
    await msg.reply({ message: `✅ Deleted: **${file.originalName}**` });
    return;
  }

  // /deleteall
  if (text === '/deleteall') {
    const count = await deleteAllFiles();
    await msg.reply({ message: `✅ Deleted ${count} file(s).` });
    return;
  }

  // File handler
  if (msg.media) {
    const processingReply = await msg.reply({ message: '⏳ Downloading file...' });
    try {
      const fileInfo = extractFileInfo(msg);
      const buffer = await client.downloadMedia(msg, { workers: 4 });
      if (!buffer || buffer.length === 0) {
        await processingReply.edit({ text: '❌ Could not download this file type.' });
        return;
      }
      const entry = await saveFile(buffer, fileInfo.name, fileInfo.mime, buffer.length);
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
      await client.editMessage(msg.chatId, {
        message: processingReply,
        text: '❌ Failed to download file. Please try again.'
      });
    }
  }
}

function extractFileInfo(msg) {
  const media = msg.media;
  const ts = Date.now();

  if (media.document) {
    const doc = media.document;
    const nameAttr = doc.attributes?.find(a => a.className === 'DocumentAttributeFilename');
    const name = nameAttr?.fileName || `file_${ts}`;
    return { name, mime: doc.mimeType || 'application/octet-stream' };
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
