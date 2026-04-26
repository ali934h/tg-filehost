# tg-filehost

Telegram bot that hosts any file you send it as a direct download link, and turns any direct URL you send it back into a Telegram file.

## Prerequisites

- Ubuntu 22.04 / 24.04 server with **root** access
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Telegram **API_ID** and **API_HASH** from <https://my.telegram.org/apps>
- Your numeric Telegram user id (ask [@userinfobot](https://t.me/userinfobot))
- A domain pointing at the server (e.g. `files.yourdomain.com`)
- A **Cloudflare Origin Certificate** for SSL — save the `.pem` and `.key` anywhere on the server (e.g. `/root/certs/`)

## Install

One-line install (run as root):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/install.sh)
```

The installer will:

- install Node.js 20, PM2, Nginx, and `pm2-logrotate`
- clone the repo to `/root/tg-filehost`
- prompt for `BOT_TOKEN`, `TG_API_ID`, `TG_API_HASH`, `ALLOWED_USERS`, `HOST`, internal port, SSL paths, upload/temp dirs, max sizes, and retention days
- build a Cloudflare-Origin-aware fullchain certificate
- write `/etc/nginx/conf.d/tg-filehost.conf`
- start the bot under PM2 and enable auto-start on boot

The bot uses **MTProto** with its bot token, so files up to **2 GB** can flow in either direction (no Local Bot API server required).

## Usage

Open a private chat with your bot:

- Send a **file** (document, photo, video, audio) → bot replies with a direct link
  `https://<HOST>/files/<id>.<ext>`.
  Files are served by nginx straight from disk.
- Send a **direct URL** (e.g. a GitHub release asset) → bot downloads it and sends it back as a Telegram document.
  URLs that return HTML (YouTube, regular web pages, …) are rejected — use [tg-video](https://github.com/ali934h/tg-video) for those.

Bot commands (also exposed via the slash-command menu in your Telegram client):

| Command | Action |
| --- | --- |
| `/start`, `/help` | Show usage instructions |
| `/files` | List/manage hosted files (with inline buttons) |
| `/storage` | Show how much disk is in use |
| `/chatid` | Show your numeric Telegram id |

## Daily commands

```bash
pm2 status                          # is the bot online?
pm2 logs tg-filehost                # live logs
pm2 restart tg-filehost             # restart
pm2 stop tg-filehost                # stop
bash /root/tg-filehost/update.sh    # pull latest code and restart
bash /root/tg-filehost/uninstall.sh # remove PM2 + nginx conf + install dir
```

## Configuration

All config lives in `/root/tg-filehost/.env` (chmod 600). See [.env.example](.env.example) for the full list. Notable knobs:

| Variable          | Default                       | Meaning                                                   |
| ----------------- | ----------------------------- | --------------------------------------------------------- |
| `ALLOWED_USERS`   | *(empty)*                     | Comma-separated user ids allowed to use the bot. Empty = open to all (NOT recommended). |
| `UPLOAD_DIR`      | `/var/lib/tg-filehost/files`  | Where hosted files live on disk and are served from by nginx. |
| `TEMP_DIR`        | `/var/lib/tg-filehost/temp`   | Staging for URL → Telegram downloads. |
| `MAX_FILE_MB`     | `2048`                        | Max size for a Telegram-uploaded file (MB). |
| `MAX_DOWNLOAD_MB` | `2048`                        | Max size for a URL-fetched file (MB). |
| `RETENTION_DAYS`  | `0`                           | Auto-delete hosted files after N days. `0` = keep forever. |
| `LOG_LEVEL`       | `info`                        | `error` / `warn` / `info` / `debug`. |

After editing `.env`, run `pm2 restart tg-filehost`.

## Troubleshooting

**Bot does not respond.** Check `pm2 logs tg-filehost`. Make sure your user id is in `ALLOWED_USERS` inside `/root/tg-filehost/.env` and that nothing else is bound to the configured `PORT`.

**`File too large`.** MTProto cap is ~2 GB. Lower `MAX_FILE_MB` / `MAX_DOWNLOAD_MB` to fit your storage budget, then `pm2 restart tg-filehost`.

**`URL points to a web page, not a direct file`.** The remote server is returning HTML (e.g. a login wall, YouTube watch page). For YouTube and similar sites use [tg-video](https://github.com/ali934h/tg-video) instead.

**`https://<HOST>/files/<name>` returns 403.** nginx (running as `www-data`) cannot read the upload directory. The default location under `/var/lib` already grants read access; if you moved `UPLOAD_DIR` somewhere else, run `chmod 755` on every parent directory and `chmod 644` on the files.

**Nginx fails with `nginx: [emerg]`.** Run `nginx -t` to see the exact error. Common causes: missing SSL files, conflicting `server_name`, port collisions.

**Forgot your config.** Edit `/root/tg-filehost/.env` (chmod 600) and `pm2 restart tg-filehost`.

**Start over.** `bash /root/tg-filehost/uninstall.sh`, then run the one-line installer again.
