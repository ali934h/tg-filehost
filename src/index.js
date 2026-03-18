require('dotenv').config();
const { app, startServer } = require('./server');
const { setupBot } = require('./bot');

async function main() {
  try {
    await startServer();
    await setupBot(app);
    console.log('[App] tg-filehost is running.');
  } catch (err) {
    console.error('[App] Fatal error:', err.message);
    process.exit(1);
  }
}

main();
