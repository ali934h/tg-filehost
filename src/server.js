const express = require('express');
const path = require('path');

const app = express();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve uploaded files
app.use('/files', express.static(UPLOAD_DIR, {
  dotfiles: 'deny',
  index: false
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[Server] Running on 127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
