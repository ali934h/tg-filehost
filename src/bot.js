const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const { saveFile, listFiles, deleteFile, deleteAllFiles, getTotalStorage, formatSize } = require('./fileManager');

const TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USERS = process.env.ALLOWED_USERS
  ? process.env.ALLOWED_USERS.split(',').map(id => parseInt(id.trim()))
  : [];
const BOT_SUBDOMAIN = process.env.BOT_SUBDOMAIN || 'bot';
const DOMAIN = process.env.DOMAIN;
const WEBHOOK_PATH = `/webhook/${TOKEN}`;
const WEBHOOK_URL = `https://${BOT_SUBDOMAIN}.${DOMAIN}${WEBHOOK_PATH}`;

let bot;

function isAllowed(userId) {
  return ALLOWED_USERS.includes(userId);
}

async function setupBot(app) {
  bot = new TelegramBot(TOKEN);

  // Set webhook
  await bot.setWebHook(WEBHOOK_URL);
  console.log(`[Bot] Webhook set to ${WEBHOOK_URL}`);

  // Attach webhook handler to Express BEFORE 404 handler
  app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  // 404 handler - must be registered AFTER webhook route
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // /start
  bot.onText(/\/start/, (msg) => {
    if (!isAllowed(msg.from.id)) return sendUnauthorized(msg.chat.id);
    bot.sendMessage(msg.chat.id,
      `👋 Welcome to *tg-filehost*!\n\nSend me any file and I'll give you a direct CDN link.\n\n` +
      `*Commands:*\n/files — List all files\n/storage — Storage usage\n/deleteall — Delete all files`,
      { parse_mode: 'Markdown' }
    );
  });

  // /storage
  bot.onText(/\/storage/, async (msg) => {
    if (!isAllowed(msg.from.id)) return sendUnauthorized(msg.chat.id);
    const { count, total } = await getTotalStorage();
    bot.sendMessage(msg.chat.id, `📦 *Storage Usage*\n\nFiles: ${count}\nTotal size: ${total}`, { parse_mode: 'Markdown' });
  });

  // /files
  bot.onText(/\/files/, async (msg) => {
    if (!isAllowed(msg.from.id)) return sendUnauthorized(msg.chat.id);
    const files = await listFiles();
    if (files.length === 0) {
      return bot.sendMessage(msg.chat.id, '📂 No files found.');
    }
    for (const file of files) {
      const date = new Date(file.uploadedAt).toLocaleString('en-GB');
      const caption = `📄 *${escapeMarkdown(file.originalName)}*\n💾 ${formatSize(file.size)}\n📅 ${date}`;
      await bot.sendMessage(msg.chat.id, caption, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔗 Copy Link', url: file.url },
              { text: '🗑 Delete', callback_data: `delete:${file.id}` }
            ]
          ]
        }
      });
    }
  });

  // /deleteall
  bot.onText(/\/deleteall/, async (msg) => {
    if (!isAllowed(msg.from.id)) return sendUnauthorized(msg.chat.id);
    bot.sendMessage(msg.chat.id, '⚠️ Are you sure you want to delete *all* files?', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Yes, delete all', callback_data: 'deleteall:confirm' },
          { text: '❌ Cancel', callback_data: 'deleteall:cancel' }
        ]]
      }
    });
  });

  // Callback queries
  bot.on('callback_query', async (query) => {
    if (!isAllowed(query.from.id)) return;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data.startsWith('delete:')) {
      const id = data.split(':')[1];
      const deleted = await deleteFile(id);
      if (deleted) {
        await bot.deleteMessage(chatId, messageId);
        await bot.answerCallbackQuery(query.id, { text: '✅ File deleted.' });
      } else {
        await bot.answerCallbackQuery(query.id, { text: '❌ File not found.' });
      }
    }

    if (data === 'deleteall:confirm') {
      const count = await deleteAllFiles();
      await bot.editMessageText(`✅ Deleted ${count} file(s).`, { chat_id: chatId, message_id: messageId });
      await bot.answerCallbackQuery(query.id);
    }

    if (data === 'deleteall:cancel') {
      await bot.editMessageText('❌ Cancelled.', { chat_id: chatId, message_id: messageId });
      await bot.answerCallbackQuery(query.id);
    }
  });

  // File handler
  bot.on('message', async (msg) => {
    if (!isAllowed(msg.from.id)) return sendUnauthorized(msg.chat.id);

    const fileData = extractFileData(msg);
    if (!fileData) return;

    const { file_id, file_name, mime_type, file_size } = fileData;

    const processingMsg = await bot.sendMessage(msg.chat.id, '⏳ Downloading file...');

    try {
      const fileLink = await bot.getFileLink(file_id);
      const response = await axios({ url: fileLink, method: 'GET', responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      const entry = await saveFile(buffer, file_name, mime_type, file_size || buffer.length);

      await bot.editMessageText(
        `✅ *File uploaded successfully!*\n\n📄 ${escapeMarkdown(entry.originalName)}\n💾 ${formatSize(entry.size)}\n\n🔗 [Direct Link](${entry.url})`,
        { chat_id: msg.chat.id, message_id: processingMsg.message_id, parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('[Bot] Upload error:', err.message);
      await bot.editMessageText('❌ Failed to download file. Please try again.', {
        chat_id: msg.chat.id,
        message_id: processingMsg.message_id
      });
    }
  });

  console.log('[Bot] Ready.');
}

function extractFileData(msg) {
  if (msg.document) return { file_id: msg.document.file_id, file_name: msg.document.file_name || 'file', mime_type: msg.document.mime_type, file_size: msg.document.file_size };
  if (msg.video) return { file_id: msg.video.file_id, file_name: `video_${Date.now()}.mp4`, mime_type: msg.video.mime_type, file_size: msg.video.file_size };
  if (msg.audio) return { file_id: msg.audio.file_id, file_name: msg.audio.file_name || `audio_${Date.now()}.mp3`, mime_type: msg.audio.mime_type, file_size: msg.audio.file_size };
  if (msg.voice) return { file_id: msg.voice.file_id, file_name: `voice_${Date.now()}.ogg`, mime_type: msg.voice.mime_type, file_size: msg.voice.file_size };
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    return { file_id: photo.file_id, file_name: `photo_${Date.now()}.jpg`, mime_type: 'image/jpeg', file_size: photo.file_size };
  }
  if (msg.sticker) return { file_id: msg.sticker.file_id, file_name: `sticker_${Date.now()}.webp`, mime_type: 'image/webp', file_size: msg.sticker.file_size };
  if (msg.animation) return { file_id: msg.animation.file_id, file_name: `animation_${Date.now()}.gif`, mime_type: msg.animation.mime_type, file_size: msg.animation.file_size };
  return null;
}

function sendUnauthorized(chatId) {
  bot.sendMessage(chatId, '🚫 You are not authorized to use this bot.');
}

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

module.exports = { setupBot };
