# tg-filehost

A Telegram bot that receives files, downloads them to your server, and returns a direct CDN link via Cloudflare.

## Features

- Receives any Telegram file (document, photo, video, audio, etc.)
- Downloads and stores files on the server with a unique UUID filename
- Returns a direct CDN link via Cloudflare
- File management: list, delete single, delete all
- Webhook-based (fast & efficient)
- Whitelist-based access control

## Requirements

- Node.js >= 18
- PM2
- Nginx
- A domain managed on Cloudflare
- Cloudflare Origin CA certificate (wildcard)

## Quick Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/setup.sh)
```

## Project Structure

```
tg-filehost/
├── src/
│   ├── index.js          # Entry point
│   ├── bot.js            # Telegram bot logic
│   ├── server.js         # Express file server
│   └── fileManager.js    # File management utilities
├── .env.example
├── ecosystem.config.js   # PM2 config
└── setup.sh              # One-line installer
```
