const express = require('express');
const path = require('path');
const fs = require('fs-extra');

const app = express();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const PORT = process.env.PORT || 3000;

// Serve uploaded files
app.use('/files', express.static(UPLOAD_DIR, {
  dotfiles: 'deny',
  index: false
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Handle webhook path - will be attached by bot.js
app.use(express.json());

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
