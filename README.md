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
- **Multi-project safe**: nginx config is isolated in `/etc/nginx/conf.d/tg-filehost.conf` — no other nginx configs are touched

## Architecture

```
Internet
   ↓
nginx :443 (SSL/TLS)          ← Cloudflare Origin CA
   ↓
Node.js 127.0.0.1:<PORT>      ← internal only, not exposed
   ↓
/var/www/tg-filehost/uploads/
```

- SSL and port 443 are handled **exclusively by nginx**
- Node.js listens on `127.0.0.1` only — never exposed to the internet
- Each project gets its own `/etc/nginx/conf.d/<project>.conf` — zero interference between projects

## Requirements

- Node.js >= 18
- PM2
- Nginx (installed automatically if missing)
- A domain managed on Cloudflare
- Cloudflare Origin CA certificate (`cert.crt` and `private.key`)
- Telegram API credentials from https://my.telegram.org

## Quick Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/setup.sh)
```

The installer will ask for:
- Telegram API credentials
- Domain and subdomain
- SSL certificate paths
- Internal Node.js port (default: `3000`)

> **Port conflict check**: the installer automatically verifies the chosen port is not already in use and is not reserved by common services (3x-ui, proxies, etc.).

## SSL Certificate Setup

Place your Cloudflare Origin CA certificate files in a directory:
```
/path/to/certs/
├── cert.crt     ← Public Key (Cloudflare Origin Certificate)
└── private.key  ← Private Key
```

The installer builds a `fullchain.pem` automatically by appending the Cloudflare CA root.

## Multi-Project Setup

You can safely run tg-filehost alongside other projects on the same server:

- nginx config is written to `/etc/nginx/conf.d/tg-filehost.conf` only
- `nginx.conf` and all other files in `conf.d/` are **never modified**
- Before reloading nginx, `nginx -t` is run — if the test fails, installation aborts and the previous config is restored
- If a previous `tg-filehost.conf` exists, it is backed up with a timestamp before overwriting
- Choose a unique internal port per project (e.g. `3000`, `3001`, `3002`, ...)

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
| `/chatid` | Get current chat ID |
