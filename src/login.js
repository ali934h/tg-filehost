/**
 * One-time login script.
 * Run manually: node src/login.js
 * After successful login, SESSION is saved to .env and this script exits.
 */
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
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

async function main() {
  console.log('');
  console.log('  tg-filehost — One-Time Login');
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
    onError: (err) => {
      console.error('  [Login] Error:', err.message);
    },
  });

  const session = client.session.save();
  const envPath = path.resolve('.env');
  let envContent = await fs.readFile(envPath, 'utf8');

  if (envContent.includes('SESSION=')) {
    envContent = envContent.replace(/^SESSION=.*$/m, `SESSION=${session}`);
  } else {
    envContent += `\nSESSION=${session}`;
  }

  await fs.writeFile(envPath, envContent);
  await client.disconnect();
  rl.close();

  console.log('');
  console.log('  ✓ Login successful! Session saved to .env');
  console.log('  You can now start the app with PM2:');
  console.log('  pm2 start ecosystem.config.js && pm2 save');
  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('[Login] Fatal:', err.message);
  process.exit(1);
});
