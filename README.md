# tg-filehost

A Telegram userbot (MTProto) that receives files, downloads them to your server, and returns a direct CDN link via Cloudflare. Supports files up to **2GB**.

## Features

- Receives any Telegram file (document, photo, video, audio, etc.)
- Downloads and stores files on the server with a unique UUID filename
- Returns a direct CDN link via Cloudflare
- File management: list, delete single, delete all
- Supports forwarded messages with files
- Whitelist-based access control by Telegram user ID
- No file size limit (up to 2GB via MTProto)

## Requirements

- Node.js >= 18
- PM2
- Nginx
- A domain managed on Cloudflare
- Cloudflare Origin CA certificate (`cert.crt` and `private.key`)
- Telegram API credentials from https://my.telegram.org

## Quick Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/setup.sh)
```

## SSL Certificate Setup

Place your Cloudflare Origin CA certificate files in a directory:
```
/path/to/certs/
├── cert.crt     ← Public Key (Cloudflare Origin Certificate)
└── private.key  ← Private Key
```

## Project Structure

```
tg-filehost/
├── src/
│   ├── index.js          # Entry point
│   ├── bot.js            # GramJS userbot logic
│   ├── server.js         # Express file server
│   └── fileManager.js    # File management utilities
├── .env.example
├── ecosystem.config.js   # PM2 config
└── setup.sh              # One-line installer
```

## Commands

| Command | Description |
|---|---|
| `/start` | Welcome message |
| `/files` | List all files with links |
| `/del_<id>` | Delete a specific file |
| `/deleteall` | Delete all files |
| `/storage` | Show storage usage |
