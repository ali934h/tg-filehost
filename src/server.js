const express = require('express');
const path = require('path');
const fs = require('fs-extra');

const app = express();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const PORT = process.env.PORT || 3000;

// Parse JSON bodies (must be before routes)
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

// Note: webhook route and 404 handler are registered in bot.js after setup

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[Server] Running on 127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
