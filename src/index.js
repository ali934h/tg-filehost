require('dotenv').config();
const { startServer } = require('./server');
const { setupUserbot } = require('./bot');

async function main() {
  try {
    await startServer();
    await setupUserbot();
    console.log('[App] tg-filehost is running.');
  } catch (err) {
    console.error('[App] Fatal error:', err.message);
    process.exit(1);
  }
}

main();
