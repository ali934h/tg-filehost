/**
 * One-time login + channel setup script.
 * Run via setup.sh or manually: node src/login.js
 */
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const readline = require('readline');
const path = require('path');
const fs = require('fs-extra');

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const PHONE = process.env.PHONE;

if (!API_ID || !API_HASH || !PHONE) {
  console.error('[Login] Missing API_ID, API_HASH or PHONE in .env');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function resolveChatId(client, input) {
  input = input.trim();
  if (!input) return null;

  try {
    // Handle invite links: https://t.me/+xxxx or https://t.me/joinchat/xxxx
    const inviteMatch = input.match(/t\.me\/(?:\+|joinchat\/)([\w-]+)/);
    if (inviteMatch) {
      const hash = inviteMatch[1];
      try {
        // Try to get chat info via invite link (without joining)
        const result = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        if (result.chat) {
          const id = result.chat.id;
          // Channels/supergroups use negative IDs with -100 prefix
          return result.chat.className === 'Channel' ? `-100${id}` : `-${id}`;
        }
      } catch (e) {
        // Already a member - get via GetDialogs
        const dialogs = await client.getDialogs({ limit: 200 });
        // Try to match by checking recent dialogs
        for (const d of dialogs) {
          if (d.entity && d.entity.migratedTo === undefined) {
            const inv = d.entity.username ? `https://t.me/${d.entity.username}` : null;
            if (inv && inv === input) {
              const id = d.entity.id;
              return d.entity.className === 'Channel' ? `-100${id}` : `-${id}`;
            }
          }
        }
        // Fallback: join temporarily to get ID
        const joined = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
        if (joined.chats && joined.chats.length > 0) {
          const chat = joined.chats[0];
          return chat.className === 'Channel' ? `-100${chat.id}` : `-${chat.id}`;
        }
      }
    }

    // Handle public username: @username or t.me/username
    const usernameMatch = input.match(/(?:@|t\.me\/)([\w]+)/);
    if (usernameMatch) {
      const entity = await client.getEntity(usernameMatch[1]);
      return entity.className === 'Channel' ? `-100${entity.id}` : `-${entity.id}`;
    }

    // Already a numeric ID
    if (/^-?\d+$/.test(input)) return input;

  } catch (err) {
    console.error(`  [Login] Could not resolve chat: ${err.message}`);
  }
  return null;
}

async function main() {
  console.log('');
  console.log('  tg-filehost \u2014 One-Time Login');
  console.log('  ================================');
  console.log(`  Phone: ${PHONE}`);
  console.log('');

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => PHONE,
    password: async () => ask('  Two-step verification password: '),
    phoneCode: async () => {
      const code = await ask('  Enter the Telegram code you received: ');
      return code.trim();
    },
    onError: (err) => console.error('  [Login] Error:', err.message),
  });

  const session = client.session.save();
  const envPath = path.resolve('.env');
  let envContent = await fs.readFile(envPath, 'utf8');

  // Save session
  if (envContent.includes('SESSION=')) {
    envContent = envContent.replace(/^SESSION=.*$/m, `SESSION=${session}`);
  } else {
    envContent += `\nSESSION=${session}`;
  }

  console.log('');
  console.log('  \u2713 Login successful!');
  console.log('');

  // Ask for channel/chat
  console.log('  \u2500\u2500 Allowed Chat Setup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log('  Enter your private channel invite link or public username.');
  console.log('  Example: https://t.me/+Qrm9UvBFvuw0NTFk  or  @mychannel');
  console.log('  Leave empty to allow all chats (not recommended).');
  console.log('');

  let allowedChats = '';
  const channelInput = await ask('  Channel link or username (or Enter to skip): ');

  if (channelInput.trim()) {
    console.log('  Resolving chat ID...');
    const chatId = await resolveChatId(client, channelInput.trim());
    if (chatId) {
      allowedChats = chatId;
      console.log(`  \u2713 Chat ID resolved: ${chatId}`);
    } else {
      console.log('  \u26a0 Could not resolve chat ID. ALLOWED_CHATS will be empty.');
      console.log('  You can add it manually in .env later.');
    }
  } else {
    console.log('  Skipped. Bot will respond in all chats.');
  }

  // Save ALLOWED_CHATS
  if (envContent.includes('ALLOWED_CHATS=')) {
    envContent = envContent.replace(/^ALLOWED_CHATS=.*$/m, `ALLOWED_CHATS=${allowedChats}`);
  } else {
    envContent += `\nALLOWED_CHATS=${allowedChats}`;
  }

  await fs.writeFile(envPath, envContent);
  await client.disconnect();
  rl.close();

  console.log('');
  console.log('  \u2713 Configuration saved to .env');
  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('[Login] Fatal:', err.message);
  process.exit(1);
});
