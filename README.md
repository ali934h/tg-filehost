# tg-filehost

Telegram userbot (MTProto) that receives files, stores them on your server, and returns a direct CDN link via Cloudflare. Supports files up to 2GB.

## Requirements

- A server with a public IP
- A domain managed on Cloudflare
- Cloudflare Origin CA certificate (`cert.crt` and `private.key`)
- Telegram API credentials from https://my.telegram.org

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/setup.sh)
```

## Daily Commands

```bash
pm2 status                    # check status
pm2 logs tg-filehost          # view logs
pm2 restart tg-filehost       # restart
bash /root/tg-filehost/update.sh      # pull latest & restart
bash /root/tg-filehost/uninstall.sh   # remove everything
```

## Troubleshooting

**Bot not responding**
```bash
pm2 logs tg-filehost --lines 50
```

**Nginx error after install**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

**File URLs return 403**
Run the following to restore nginx read permissions:
```bash
chmod 755 /root
chmod -R 755 /root/tg-filehost-downloads
```

**Re-login to Telegram**
Clear the `SESSION` value in `/root/tg-filehost/.env`, then restart:
```bash
pm2 restart tg-filehost
```
