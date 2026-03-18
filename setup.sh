#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo '  _                __ _ _     _               _'
echo ' | |_ __ _ ____  / _(_) |___| |_  ___  ___ | |_'
echo " | __/ _\` |_  / | |_| | / -_) ' \/ _ \(_-< |  _|"
echo ' |__\__,_/__/ |_|  _|_|_\___|_||_\___//__/  \__|'
echo '              |_|'
echo -e "${NC}"
echo -e "${GREEN}Welcome to tg-filehost installer${NC}"
echo ""

# ------------------------------
# Collect user input
# ------------------------------

read -rp "$(echo -e ${CYAN}"Bot Token (from @BotFather): "${NC})" BOT_TOKEN
[[ -z "$BOT_TOKEN" ]] && echo -e "${RED}Error: Bot token is required.${NC}" && exit 1

read -rp "$(echo -e ${CYAN}"Allowed user IDs (comma-separated, e.g. 123456,789012): "${NC})" ALLOWED_USERS
[[ -z "$ALLOWED_USERS" ]] && echo -e "${RED}Error: At least one user ID is required.${NC}" && exit 1

read -rp "$(echo -e ${CYAN}"Main domain (e.g. yourdomain.com): "${NC})" DOMAIN
[[ -z "$DOMAIN" ]] && echo -e "${RED}Error: Domain is required.${NC}" && exit 1

read -rp "$(echo -e ${CYAN}"Files subdomain [default: files]: "${NC})" FILES_SUBDOMAIN
FILES_SUBDOMAIN=${FILES_SUBDOMAIN:-files}

read -rp "$(echo -e ${CYAN}"Bot subdomain [default: bot]: "${NC})" BOT_SUBDOMAIN
BOT_SUBDOMAIN=${BOT_SUBDOMAIN:-bot}

read -rp "$(echo -e ${CYAN}"SSL Certificate path (.pem): "${NC})" SSL_CERT_PATH
[[ ! -f "$SSL_CERT_PATH" ]] && echo -e "${RED}Error: Certificate file not found.${NC}" && exit 1

read -rp "$(echo -e ${CYAN}"SSL Private Key path (.key): "${NC})" SSL_KEY_PATH
[[ ! -f "$SSL_KEY_PATH" ]] && echo -e "${RED}Error: Private key file not found.${NC}" && exit 1

read -rp "$(echo -e ${CYAN}"Upload directory [default: /var/www/tg-filehost/uploads]: "${NC})" UPLOAD_DIR
UPLOAD_DIR=${UPLOAD_DIR:-/var/www/tg-filehost/uploads}

read -rp "$(echo -e ${CYAN}"Express port [default: 3000]: "${NC})" PORT
PORT=${PORT:-3000}

INSTALL_DIR="/var/www/tg-filehost"

echo ""
echo -e "${YELLOW}--- Configuration Summary ---${NC}"
echo -e "  Domain        : ${DOMAIN}"
echo -e "  Files URL     : https://${FILES_SUBDOMAIN}.${DOMAIN}/files/"
echo -e "  Webhook URL   : https://${BOT_SUBDOMAIN}.${DOMAIN}/webhook/***"
echo -e "  Upload dir    : ${UPLOAD_DIR}"
echo -e "  Express port  : ${PORT}"
echo -e "  Install dir   : ${INSTALL_DIR}"
echo ""
read -rp "$(echo -e ${YELLOW}"Proceed with installation? [y/N]: "${NC})" CONFIRM
[[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]] && echo "Aborted." && exit 0

# ------------------------------
# Install dependencies
# ------------------------------

echo -e "\n${GREEN}[1/6] Checking system dependencies...${NC}"

if ! command -v node &>/dev/null || [[ $(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)") ]]; then
  echo -e "${YELLOW}Installing Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo -e "  Node.js $(node -v) found."
fi

if ! command -v pm2 &>/dev/null; then
  echo -e "${YELLOW}Installing PM2...${NC}"
  sudo npm install -g pm2
else
  echo -e "  PM2 $(pm2 -v) found."
fi

if ! command -v nginx &>/dev/null; then
  echo -e "${YELLOW}Installing Nginx...${NC}"
  sudo apt-get install -y nginx
else
  echo -e "  Nginx found."
fi

# ------------------------------
# Clone / update repo
# ------------------------------

echo -e "\n${GREEN}[2/6] Setting up project files...${NC}"

if [[ -d "$INSTALL_DIR" ]]; then
  echo -e "  Directory exists, pulling latest changes..."
  cd "$INSTALL_DIR" && git pull
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$USER":"$USER" "$INSTALL_DIR"
  git clone https://github.com/ali934h/tg-filehost.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

mkdir -p "$UPLOAD_DIR" logs

# ------------------------------
# Write .env
# ------------------------------

echo -e "\n${GREEN}[3/6] Writing .env file...${NC}"

cat > "$INSTALL_DIR/.env" <<EOF
BOT_TOKEN=${BOT_TOKEN}
ALLOWED_USERS=${ALLOWED_USERS}
DOMAIN=${DOMAIN}
FILES_SUBDOMAIN=${FILES_SUBDOMAIN}
BOT_SUBDOMAIN=${BOT_SUBDOMAIN}
PORT=${PORT}
UPLOAD_DIR=${UPLOAD_DIR}
SSL_CERT_PATH=${SSL_CERT_PATH}
SSL_KEY_PATH=${SSL_KEY_PATH}
EOF

echo -e "  .env written."

# ------------------------------
# npm install
# ------------------------------

echo -e "\n${GREEN}[4/6] Installing Node.js packages...${NC}"
cd "$INSTALL_DIR" && npm install --omit=dev

# ------------------------------
# Configure Nginx
# ------------------------------

echo -e "\n${GREEN}[5/6] Configuring Nginx...${NC}"

sudo tee /etc/nginx/sites-available/tg-filehost > /dev/null <<EOF
# --- Files subdomain ---
server {
    listen 443 ssl;
    server_name ${FILES_SUBDOMAIN}.${DOMAIN};

    ssl_certificate     ${SSL_CERT_PATH};
    ssl_certificate_key ${SSL_KEY_PATH};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location /files/ {
        alias ${UPLOAD_DIR}/;
        autoindex off;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        return 404;
    }
}

# --- Bot subdomain ---
server {
    listen 443 ssl;
    server_name ${BOT_SUBDOMAIN}.${DOMAIN};

    ssl_certificate     ${SSL_CERT_PATH};
    ssl_certificate_key ${SSL_KEY_PATH};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location /webhook/ {
        proxy_pass         http://localhost:${PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://localhost:${PORT};
    }

    location / {
        return 404;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/tg-filehost /etc/nginx/sites-enabled/tg-filehost
sudo nginx -t && sudo systemctl reload nginx
echo -e "  Nginx configured and reloaded."

# ------------------------------
# Start with PM2
# ------------------------------

echo -e "\n${GREEN}[6/6] Starting application with PM2...${NC}"
cd "$INSTALL_DIR"
pm2 delete tg-filehost 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
sudo pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | sudo bash

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  tg-filehost installed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  Files URL : https://${FILES_SUBDOMAIN}.${DOMAIN}/files/"
echo -e "  Bot health: https://${BOT_SUBDOMAIN}.${DOMAIN}/health"
echo -e "  PM2 status: pm2 status"
echo -e "  PM2 logs  : pm2 logs tg-filehost"
echo ""
