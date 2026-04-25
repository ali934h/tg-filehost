# tg-filehost

Self-hosted Telegram userbot that turns any file you forward to it into a direct
download link. Send a file → bot streams it to your server → you get back a
short HTTPS URL like `https://files.example.com/files/<uuid>.mp4` that you can
share, embed, or pipe into other tools.

Backed by [GramJS](https://gram.js.org/) (MTProto), so it can handle files up to
**2 GB** — far above what a Bot API account can fetch.

> ⚠️ **Privacy**: this is a *userbot*, not a bot account. It logs in as your
> personal Telegram account and the saved session has full read/write access to
> that account. Run it only on a server you control, expose it only over HTTPS,
> and treat the `SESSION` value in `.env` like a password.

---

## What it does

- Listens for files in the chats you allow.
- Streams each file (up to 2 GB) directly to disk on your server.
- Stores files under a UUID and serves them statically via Nginx with long
  cache headers — no HTTP authentication, just an unguessable URL.
- Provides Telegram commands to list, delete, and audit storage.

### Telegram commands

| Command       | What it does                                          |
| ------------- | ----------------------------------------------------- |
| `/start`, `/help` | Show the help text                                |
| `/files`      | List all uploaded files (paginated, 10 per message)   |
| `/storage`    | Show file count and total disk usage                  |
| `/del_<id>`   | Delete one file (id is the short prefix from `/files`)|
| `/deleteall`  | Delete every uploaded file                            |
| `/chatid`     | Print the current chat's numeric ID                   |

---

## Architecture

```
┌─────────────┐  MTProto  ┌──────────────────────────────┐
│  Telegram   │ ────────► │ Node userbot (PM2)           │
│  servers    │           │ ─ src/bot.js: command router │
└─────────────┘           │ ─ src/fileManager.js: stream │
       ▲                  │ ─ src/server.js: /health     │
       │                  └────────────┬─────────────────┘
       │                               │ writes to disk
       │                               ▼
       │                  /var/lib/tg-filehost/files/
       │                               │
       │                               ▼
       │                  ┌──────────────────────────────┐
       │  HTTPS download  │ Nginx (Cloudflare Origin SSL)│
       └────────────────► │  /files/<uuid>.<ext>         │
                          └──────────────────────────────┘
```

Files are streamed to a `.tmp/` partial first, then atomically renamed into
the upload directory. Metadata (id, original name, size, URL, timestamps) is
serialised through a small in-process write queue so concurrent uploads can't
clobber each other.

The Express app on `127.0.0.1:PORT` only serves `/health`. **Nginx** serves the
files directly from disk via an `alias` — no Node hop, no buffering caps.

---

## Prerequisites

- Ubuntu 20.04 or 22.04 server, root access
- A domain pointing at the server (e.g. `files.example.com`)
- Telegram API credentials from
  [my.telegram.org](https://my.telegram.org/apps) → **API development tools**
- A **Cloudflare Origin Certificate** for SSL — save the `.pem` and `.key`
  files anywhere on the server (e.g. `/root/certs/`)

---

## Installation

SSH in **as root** and run:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/install.sh)
```

The installer will:

1. Install Node.js 20, PM2, Nginx, and `pm2-logrotate`.
2. Clone the repo to `/root/tg-filehost`.
3. Prompt for `API_ID`, `API_HASH`, phone number, allowed users/chats, host,
   internal port, SSL cert/key paths, upload directory and max file size.
4. Configure Nginx in `/etc/nginx/conf.d/tg-filehost.conf` and reload.
5. Run `node setup.js` to log into Telegram (sends a code to your account;
   supports 2FA). The session string is written into `.env` automatically.
6. Start the userbot under PM2 and persist with `pm2 save` + `pm2 startup`.

After installation, send any file to your own Saved Messages (or to one of the
chats listed in `ALLOWED_CHATS`) and the bot will reply with the link.

---

## Daily commands

```bash
pm2 status                              # is the bot online?
pm2 logs tg-filehost                    # live logs
pm2 restart tg-filehost                 # restart
bash /root/tg-filehost/update.sh        # git pull + npm install + pm2 restart
bash /root/tg-filehost/uninstall.sh     # remove PM2 + nginx conf + install dir
```

---

## Configuration

All config lives in `/root/tg-filehost/.env` (chmod 600). See
[`.env.example`](.env.example) for the full list. Notable knobs:

| Variable        | Default                          | Meaning                                                                 |
| --------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `API_ID`        | —                                | Telegram API ID from my.telegram.org                                    |
| `API_HASH`      | —                                | Telegram API hash from my.telegram.org                                  |
| `PHONE`         | —                                | Phone number used to log in (with country code)                         |
| `SESSION`       | written by `setup.js`            | GramJS string session; **secret**                                       |
| `ALLOWED_USERS` | —                                | Comma-separated user IDs allowed to interact with the bot               |
| `ALLOWED_CHATS` | empty                            | If set, only messages from these chat IDs are accepted (overrides users)|
| `HOST`          | —                                | Public host that points at this server (no scheme, no trailing slash)   |
| `PORT`          | `3000`                           | Internal port the Node app binds to (127.0.0.1 only)                    |
| `UPLOAD_DIR`    | `/var/lib/tg-filehost/files`     | Where uploaded files are stored on disk                                 |
| `MAX_FILE_MB`   | `2048`                           | Hard limit per upload, in megabytes                                     |
| `LOG_LEVEL`     | `info`                           | One of `error` / `warn` / `info` / `debug`                              |

After editing `.env`, restart the bot:

```bash
pm2 restart tg-filehost
```

### Adding allowed users

Edit `/root/tg-filehost/.env` and append to `ALLOWED_USERS` (comma-separated,
no spaces):

```dotenv
ALLOWED_USERS=8261361884,77933874,123456789
```

Then `pm2 restart tg-filehost`.

### Re-authenticating

If the session expires or you want to switch accounts:

1. Edit `/root/tg-filehost/.env` and clear the `SESSION=` value.
2. Run `cd /root/tg-filehost && node setup.js`, enter the OTP and 2FA password
   if prompted.
3. `pm2 restart tg-filehost`.

---

## Why a userbot?

A standard Telegram **bot account** can't download files larger than 50 MB via
the Bot API. By logging in with your own account through MTProto, this project
can stream files up to 2 GB straight to disk. The trade-off is that the saved
session has full access to your account; you should isolate it on a dedicated
account if you don't trust the host.

---

## Security notes

- **Public file URLs.** Anyone who has the URL can download the file. The
  filename is a UUID v4 (≈122 bits of entropy) so URLs are practically
  unguessable, but they are not authenticated. Treat each link as a secret you
  share deliberately.
- **`SESSION` is sensitive.** It is the equivalent of being logged into your
  Telegram account. The installer writes `.env` with `chmod 600`. Don't commit
  it, don't paste it into chats, don't put it on backup volumes that other
  people can read.
- **Upload directory permissions.** The default `UPLOAD_DIR` is
  `/var/lib/tg-filehost/files`, which lives outside `/root` so Nginx can serve
  it without weakening permissions on your home directory. Old versions of this
  installer ran `chmod 755 /root` to work around that — **don't do that**;
  it makes the names of every file under `/root` (other projects' `.env`,
  ssh keys, etc.) world-listable. The current installer never touches `/root`
  unless you explicitly point `UPLOAD_DIR` inside it.
- **Allow-listing.** With both `ALLOWED_USERS` and `ALLOWED_CHATS` empty, the
  bot refuses every message. At least one must be configured.

---

## Troubleshooting

**Bot doesn't reply.** First check the logs:

```bash
pm2 logs tg-filehost --lines 100
```

If you see `SESSION is empty`, run `node setup.js` again. If you see
`AUTH_KEY_DUPLICATED`, your account was logged out from another device — clear
`SESSION=` in `.env` and re-run `setup.js`.

**File URLs return 403.** Make sure Nginx (`www-data`) can read `UPLOAD_DIR`:

```bash
ls -ld /var/lib/tg-filehost /var/lib/tg-filehost/files
# should show 755 (rwxr-xr-x) on both
```

If you've moved the upload dir under `/root`, you also need to grant
traversal: `chmod o+x /root` (which is much safer than `chmod 755 /root`).

**Nginx test fails on install.** The installer aborts cleanly — your existing
config is left untouched. Run `nginx -t` manually to see the error and check
that the cert/key paths you typed are correct.

**File too large.** Either bump `MAX_FILE_MB` in `.env` (Telegram's hard cap
is 2048) and `pm2 restart`, or split the file before uploading.

---

## FAQ

**Where do I find the SESSION string?**
You don't enter it manually. The installer runs `node setup.js`, which logs in
once with your phone number and writes the session into `.env`.

**Can I use a regular bot account instead of a userbot?**
No — bot accounts can't fetch files over 50 MB. If you only need small files,
fork the project and replace the GramJS download with the Bot API.

**How do I rotate the session?**
Clear `SESSION=` in `.env`, then run `node setup.js` and `pm2 restart`.

**How do I auto-clean old files?**
Not supported out of the box — files stay until you delete them with `/del_`
or `/deleteall`. Add a cron job over `UPLOAD_DIR` if you need a TTL.

---

## Repository layout

```
.
├── install.sh              # one-shot installer (root)
├── update.sh               # git pull + npm install + pm2 restart
├── uninstall.sh            # stops pm2, removes config, optionally wipes uploads
├── setup.js                # one-time Telegram login → writes SESSION to .env
├── ecosystem.config.cjs    # PM2 config
├── nginx/tg-filehost.conf  # nginx template, populated by install.sh
├── package.json
└── src/
    ├── index.js            # entrypoint
    ├── config.js           # env parsing + validation
    ├── logger.js           # tiny levelled logger
    ├── telegram.js         # GramJS client lifecycle
    ├── commands.js         # message router & command handlers
    ├── bot.js              # connects telegram → commands
    ├── server.js           # /health endpoint
    └── fileManager.js      # streaming download, meta lock, formatters
```

---

## License

MIT.
