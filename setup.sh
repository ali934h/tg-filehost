#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo -e "${CYAN}${BOLD}"
echo '  _                __ _ _     _               _'
echo ' | |_ __ _ ____  / _(_) |___| |_  ___  ___ | |_'
echo " | __/ _\` |_  / | |_| | / -_) ' \\/ _ \\(_-< |  _|"
echo ' |__\__,_/__/ |_|  _|_|_\___|_||_\___//__/  \__|'
echo '              |_|'
echo -e "${NC}"
echo -e "${GREEN}${BOLD}  Welcome to tg-filehost v2 installer${NC}"
echo -e "  Powered by GramJS (MTProto) — supports files up to 2GB"
echo ""
echo -e "${YELLOW}  You need: API ID & API Hash from https://my.telegram.org${NC}"
echo ""

# ------------------------------
# Helper functions
# ------------------------------

prompt_required() {
  local var_name="$1"
  local prompt_text="$2"
  local value
  while true; do
    read -rp "$(echo -e ${CYAN}"${prompt_text}: "${NC})" value
    if [[ -n "$value" ]]; then
      eval "$var_name='$value'"
      break
    else
      echo -e "  ${RED}✗ This field is required. Please try again.${NC}"
    fi
  done
}

prompt_file() {
  local var_name="$1"
  local prompt_text="$2"
  local value
  while true; do
    read -rp "$(echo -e ${CYAN}"${prompt_text}: "${NC})" value
    if [[ -z "$value" ]]; then
      echo -e "  ${RED}✗ This field is required. Please try again.${NC}"
    elif [[ ! -f "$value" ]]; then
      echo -e "  ${RED}✗ File not found: ${value}${NC}"
      echo -e "  ${YELLOW}  Please check the path and try again.${NC}"
    else
      eval "$var_name='$value'"
      echo -e "  ${GREEN}✓ File found.${NC}"
      break
    fi
  done
}

prompt_default() {
  local var_name="$1"
  local prompt_text="$2"
  local default="$3"
  local value
  read -rp "$(echo -e ${CYAN}"${prompt_text} [default: ${default}]: "${NC})" value
  eval "$var_name='${value:-$default}'"
}

# ------------------------------
# Collect user input
# ------------------------------

echo -e "${BOLD}── Telegram Credentials ──────────────────────────${NC}"
prompt_required API_ID        "Telegram API ID"
prompt_required API_HASH      "Telegram API Hash"
prompt_required PHONE         "Phone number (e.g. +989123456789)"
prompt_required ALLOWED_USERS "Allowed Telegram user IDs (comma-separated)"
echo ""

echo -e "${BOLD}── Domain Setup ──────────────────────────────────${NC}"
prompt_required DOMAIN        "Main domain (e.g. yourdomain.com)"
prompt_default  FILES_SUBDOMAIN "Files subdomain" "files"
echo ""

echo -e "${BOLD}── SSL Certificates ──────────────────────────────${NC}"
echo -e "  ${YELLOW}Tip: Cloudflare Origin CA → Create Certificate → Copy to server${NC}"
echo ""
prompt_file SSL_CERT "SSL Public Key path  (e.g. /root/certs/cert.crt)"
prompt_file SSL_KEY  "SSL Private Key path (e.g. /root/certs/private.key)"
SSL_DIR=$(dirname "$SSL_CERT")
echo ""

echo -e "${BOLD}── Server Config ─────────────────────────────────${NC}"
prompt_default UPLOAD_DIR "Upload directory" "/var/www/tg-filehost/uploads"
prompt_default PORT        "Express port"     "3000"
echo ""

INSTALL_DIR="/var/www/tg-filehost"

# ------------------------------
# Summary
# ------------------------------

echo -e "${BOLD}${YELLOW}┌─────────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}${YELLOW}│           Configuration Summary                 │${NC}"
echo -e "${BOLD}${YELLOW}└─────────────────────────────────────────────────┘${NC}"
echo -e "  Domain        : ${DOMAIN}"
echo -e "  Files URL     : https://${FILES_SUBDOMAIN}.${DOMAIN}/files/"
echo -e "  SSL Cert      : ${SSL_CERT}"
echo -e "  SSL Key       : ${SSL_KEY}"
echo -e "  Upload dir    : ${UPLOAD_DIR}"
echo -e "  Express port  : ${PORT}"
echo -e "  Install dir   : ${INSTALL_DIR}"
echo ""

while true; do
  read -rp "$(echo -e ${YELLOW}"Proceed with installation? [y/n]: "${NC})" CONFIRM
  case "$CONFIRM" in
    y|Y) break ;;
    n|N) echo -e "\n${YELLOW}Installation cancelled.${NC}" && exit 0 ;;
    *) echo -e "  ${RED}✗ Please enter y or n.${NC}" ;;
  esac
done

# ------------------------------
# [1/6] System dependencies
# ------------------------------

echo -e "\n${GREEN}${BOLD}[1/6] Checking system dependencies...${NC}"

if ! command -v node &>/dev/null || node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null; then
  echo -e "  ${YELLOW}Node.js not found or version < 18. Installing Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - &>/dev/null
  sudo apt-get install -y nodejs &>/dev/null
  echo -e "  ${GREEN}✓ Node.js $(node -v) installed.${NC}"
else
  echo -e "  ${GREEN}✓ Node.js $(node -v) found.${NC}"
fi

if ! command -v pm2 &>/dev/null; then
  echo -e "  ${YELLOW}PM2 not found. Installing...${NC}"
  sudo npm install -g pm2 &>/dev/null
  echo -e "  ${GREEN}✓ PM2 installed.${NC}"
else
  echo -e "  ${GREEN}✓ PM2 $(pm2 -v) found.${NC}"
fi

if ! command -v nginx &>/dev/null; then
  echo -e "  ${YELLOW}Nginx not found. Installing...${NC}"
  sudo apt-get install -y nginx &>/dev/null
  echo -e "  ${GREEN}✓ Nginx installed.${NC}"
else
  echo -e "  ${GREEN}✓ Nginx found.${NC}"
fi

# ------------------------------
# [2/6] Project files
# ------------------------------

echo -e "\n${GREEN}${BOLD}[2/6] Setting up project files...${NC}"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo -e "  ${YELLOW}Directory exists, pulling latest changes...${NC}"
  cd "$INSTALL_DIR" && git pull
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$USER":"$USER" "$INSTALL_DIR"
  git clone https://github.com/ali934h/tg-filehost.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

mkdir -p "$UPLOAD_DIR" "$INSTALL_DIR/logs"
echo -e "  ${GREEN}✓ Project files ready.${NC}"

echo -e "  Building SSL fullchain..."
curl -fsSL https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem -o "${SSL_DIR}/cloudflare_ca.pem"
cat "${SSL_CERT}" "${SSL_DIR}/cloudflare_ca.pem" > "${SSL_DIR}/fullchain.pem"
echo -e "  ${GREEN}✓ fullchain.pem created.${NC}"

# ------------------------------
# [3/6] Write .env
# ------------------------------

echo -e "\n${GREEN}${BOLD}[3/6] Writing .env file...${NC}"

cat > "$INSTALL_DIR/.env" <<EOF
API_ID=${API_ID}
API_HASH=${API_HASH}
PHONE=${PHONE}
SESSION=
ALLOWED_USERS=${ALLOWED_USERS}
DOMAIN=${DOMAIN}
FILES_SUBDOMAIN=${FILES_SUBDOMAIN}
PORT=${PORT}
UPLOAD_DIR=${UPLOAD_DIR}
SSL_CERT=${SSL_CERT}
SSL_KEY=${SSL_KEY}
SSL_FULLCHAIN=${SSL_DIR}/fullchain.pem
EOF

echo -e "  ${GREEN}✓ .env written.${NC}"

# ------------------------------
# [4/6] npm install
# ------------------------------

echo -e "\n${GREEN}${BOLD}[4/6] Installing Node.js packages...${NC}"
cd "$INSTALL_DIR" && npm install --omit=dev
echo -e "  ${GREEN}✓ Packages installed.${NC}"

# ------------------------------
# [5/6] Nginx
# ------------------------------

echo -e "\n${GREEN}${BOLD}[5/6] Configuring Nginx...${NC}"

sudo tee /etc/nginx/sites-available/tg-filehost > /dev/null <<EOF
server {
    listen 443 ssl;
    server_name ${FILES_SUBDOMAIN}.${DOMAIN};

    ssl_certificate     ${SSL_DIR}/fullchain.pem;
    ssl_certificate_key ${SSL_KEY};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location /files/ {
        alias ${UPLOAD_DIR}/;
        autoindex off;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /health {
        proxy_pass http://127.0.0.1:${PORT};
    }

    location / {
        return 404;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/tg-filehost /etc/nginx/sites-enabled/tg-filehost
sudo nginx -t && sudo systemctl reload nginx
echo -e "  ${GREEN}✓ Nginx configured and reloaded.${NC}"

# ------------------------------
# [6/6] Telegram Login
# ------------------------------

echo -e "\n${GREEN}${BOLD}[6/6] Telegram Login${NC}"
echo -e "  ${YELLOW}A verification code will be sent to your Telegram account.${NC}"
echo -e "  ${YELLOW}Enter it below to complete setup.${NC}"
echo ""

cd "$INSTALL_DIR"
node src/login.js

# login.js exits 0 on success, which means SESSION is now in .env
# Now start PM2
echo -e "\n${GREEN}${BOLD}Starting application with PM2...${NC}"
pm2 delete tg-filehost 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
sudo pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | sudo bash
echo -e "  ${GREEN}✓ PM2 started and saved.${NC}"

# ------------------------------
# Done
# ------------------------------

echo ""
echo -e "${GREEN}${BOLD}┌─────────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}${BOLD}│       tg-filehost installed successfully! ✓     │${NC}"
echo -e "${GREEN}${BOLD}└─────────────────────────────────────────────────┘${NC}"
echo -e "  Files URL  : https://${FILES_SUBDOMAIN}.${DOMAIN}/files/"
echo -e "  Health     : https://${FILES_SUBDOMAIN}.${DOMAIN}/health"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "  pm2 status"
echo -e "  pm2 logs tg-filehost"
echo -e "  pm2 restart tg-filehost"
echo ""
