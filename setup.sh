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

# Ports that are commonly used by other services (e.g. 3x-ui, proxies, etc.)
BLOCKED_PORTS=(80 443 1080 2053 2083 2087 2096 3128 8080 8443 8880)

is_blocked_port() {
  local p="$1"
  for bp in "${BLOCKED_PORTS[@]}"; do
    [[ "$p" == "$bp" ]] && return 0
  done
  return 1
}

is_port_in_use() {
  ss -tlnp 2>/dev/null | grep -q ":$1 " || \
  netstat -tlnp 2>/dev/null | grep -q ":$1 "
}

prompt_port() {
  local var_name="$1"
  local default="$2"
  local port

  while true; do
    read -rp "$(echo -e ${CYAN}"Internal Node.js port [default: ${default}]: "${NC})" port
    port="${port:-$default}"

    if ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
      echo -e "  ${RED}✗ Invalid port. Choose a number between 1024 and 65535.${NC}"
      continue
    fi

    if is_blocked_port "$port"; then
      echo -e "  ${RED}✗ Port ${port} is reserved for common services (nginx, 3x-ui, proxies).${NC}"
      echo -e "  ${YELLOW}  Please choose a different port.${NC}"
      continue
    fi

    if is_port_in_use "$port"; then
      echo -e "  ${RED}✗ Port ${port} is already in use on this server.${NC}"
      echo -e "  ${YELLOW}  Please choose a different port.${NC}"
      continue
    fi

    eval "$var_name='$port'"
    echo -e "  ${GREEN}✓ Port ${port} is available.${NC}"
    break
  done
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
echo -e "  ${YELLOW}Enter the full domain or subdomain that points to this server.${NC}"
echo -e "  ${YELLOW}Example: tg-filehost.example.com  or  files.example.com${NC}"
echo ""
prompt_required HOST "Host (e.g. tg-filehost.example.com)"
echo ""

echo -e "${BOLD}── SSL Certificates ──────────────────────────────${NC}"
echo -e "  ${YELLOW}Tip: Cloudflare Origin CA → Create Certificate → Copy to server${NC}"
echo ""
prompt_file SSL_CERT "SSL Public Key path  (e.g. /root/certs/cert.crt)"
prompt_file SSL_KEY  "SSL Private Key path (e.g. /root/certs/private.key)"
SSL_DIR=$(dirname "$SSL_CERT")
echo ""

echo -e "${BOLD}── Server Config ─────────────────────────────────${NC}"
prompt_default UPLOAD_DIR "Upload directory" "/root/tg-filehost-downloads"
echo -e "  ${YELLOW}Note: Port 80/443 are handled by nginx. Choose an internal port for Node.js.${NC}"
echo -e "  ${YELLOW}Avoid: 1080, 2053, 2083, 8080 (used by 3x-ui / common proxies)${NC}"
prompt_port PORT "3000"
echo ""

INSTALL_DIR="/root/tg-filehost"
NGINX_CONF="/etc/nginx/conf.d/tg-filehost.conf"

# ------------------------------
# Summary
# ------------------------------

echo -e "${BOLD}${YELLOW}┌─────────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}${YELLOW}│           Configuration Summary                 │${NC}"
echo -e "${BOLD}${YELLOW}└─────────────────────────────────────────────────┘${NC}"
echo -e "  Host          : ${HOST}"
echo -e "  Files URL     : https://${HOST}/files/"
echo -e "  SSL Cert      : ${SSL_CERT}"
echo -e "  SSL Key       : ${SSL_KEY}"
echo -e "  Upload dir    : ${UPLOAD_DIR}"
echo -e "  Node.js port  : 127.0.0.1:${PORT} (internal only)"
echo -e "  Nginx config  : ${NGINX_CONF}"
echo -e "  Install dir   : ${INSTALL_DIR}"
echo ""
echo -e "  ${YELLOW}${BOLD}Warning: Any previous installation will be fully removed.${NC}"
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
# [0/6] Cleanup previous install
# ------------------------------

echo -e "\n${GREEN}${BOLD}[0/6] Cleaning up previous installation...${NC}"

if command -v pm2 &>/dev/null; then
  pm2 delete tg-filehost 2>/dev/null && echo -e "  ${YELLOW}PM2 process removed.${NC}" || true
  pm2 save --force 2>/dev/null || true
fi

if [[ -f "$NGINX_CONF" ]]; then
  BACKUP_PATH="${NGINX_CONF}.bak.$(date +%Y%m%d%H%M%S)"
  sudo cp "$NGINX_CONF" "$BACKUP_PATH"
  sudo rm -f "$NGINX_CONF"
  echo -e "  ${YELLOW}Nginx config backed up to: ${BACKUP_PATH} and removed.${NC}"
fi

if [[ -L /etc/nginx/sites-enabled/tg-filehost ]]; then
  sudo rm /etc/nginx/sites-enabled/tg-filehost
  echo -e "  ${YELLOW}Removed old sites-enabled symlink.${NC}"
fi
if [[ -f /etc/nginx/sites-available/tg-filehost ]]; then
  sudo rm /etc/nginx/sites-available/tg-filehost
  echo -e "  ${YELLOW}Removed old sites-available config.${NC}"
fi

if [[ -d "$INSTALL_DIR" ]]; then
  sudo rm -rf "$INSTALL_DIR"
  echo -e "  ${YELLOW}Removed old install directory: ${INSTALL_DIR}${NC}"
fi

echo -e "  ${GREEN}✓ Cleanup complete.${NC}"

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
  sudo systemctl enable nginx &>/dev/null
  sudo systemctl start nginx &>/dev/null
  echo -e "  ${GREEN}✓ Nginx installed and started.${NC}"
else
  echo -e "  ${GREEN}✓ Nginx found.${NC}"
fi

# ------------------------------
# [2/6] Project files
# ------------------------------

echo -e "\n${GREEN}${BOLD}[2/6] Setting up project files...${NC}"

mkdir -p "$INSTALL_DIR"
git clone https://github.com/ali934h/tg-filehost.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

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
ALLOWED_CHATS=
# Full host (domain or subdomain) — used to build file URLs
HOST=${HOST}
# Internal port — Node.js listens on 127.0.0.1 only. nginx proxies 443 → this port.
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

sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 443 ssl;
    server_name ${HOST};

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
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location / {
        return 404;
    }
}
EOF

echo -e "  ${CYAN}Testing nginx configuration...${NC}"
if ! sudo nginx -t 2>&1; then
  echo -e "\n  ${RED}✗ Nginx configuration test FAILED.${NC}"
  echo -e "  ${RED}  Aborting installation to prevent breaking other services.${NC}"
  sudo rm -f "$NGINX_CONF"
  exit 1
fi

sudo systemctl reload nginx
echo -e "  ${GREEN}✓ Nginx configured and reloaded.${NC}"

# ------------------------------
# [6/6] Telegram Login & Channel Setup
# ------------------------------

echo -e "\n${GREEN}${BOLD}[6/6] Telegram Login & Channel Setup${NC}"
echo -e "  ${YELLOW}A verification code will be sent to your Telegram account.${NC}"
echo -e "  ${YELLOW}After login, enter your private channel invite link.${NC}"
echo ""

cd "$INSTALL_DIR"
node src/login.js

# ------------------------------
# Start PM2
# ------------------------------

echo -e "\n${GREEN}${BOLD}Starting application with PM2...${NC}"
pm2 start ecosystem.config.js
pm2 save

# Fix: extract only the sudo command from pm2 startup output
STARTUP_CMD=$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | grep -E '^sudo ')
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
fi

echo -e "  ${GREEN}✓ PM2 started and saved.${NC}"

# ------------------------------
# Done
# ------------------------------

echo ""
echo -e "${GREEN}${BOLD}┌─────────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}${BOLD}│       tg-filehost installed successfully! ✓     │${NC}"
echo -e "${GREEN}${BOLD}└─────────────────────────────────────────────────┘${NC}"
echo -e "  Files URL  : https://${HOST}/files/"
echo -e "  Health     : https://${HOST}/health"
echo -e "  Node.js    : 127.0.0.1:${PORT} (internal)"
echo -e "  Nginx conf : ${NGINX_CONF}"
echo -e "  Install dir: ${INSTALL_DIR}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "  pm2 status"
echo -e "  pm2 logs tg-filehost"
echo -e "  pm2 restart tg-filehost"
echo ""
