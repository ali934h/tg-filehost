#!/usr/bin/env bash
# tg-filehost installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/install.sh)

set -euo pipefail

REPO_URL="https://github.com/ali934h/tg-filehost.git"
PROJECT="tg-filehost"
INSTALL_DIR="/root/${PROJECT}"
DEFAULT_UPLOAD_DIR="/var/lib/${PROJECT}/files"
DEFAULT_TEMP_DIR="/var/lib/${PROJECT}/temp"
NODE_MAJOR=20

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step()  { echo -e "\n${BOLD}${BLUE}==>${NC} ${BOLD}$*${NC}"; }
info()  { echo -e "${CYAN}  ->${NC} $*"; }
warn()  { echo -e "${YELLOW}  !!${NC} $*"; }
ok()    { echo -e "${GREEN}  ok${NC} $*"; }
err()   { echo -e "${RED}  xx${NC} $*" >&2; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "This installer must be run as root."
    exit 1
  fi
}

banner() {
  echo
  echo -e "${BOLD}${CYAN}========================================${NC}"
  echo -e "${BOLD}${CYAN}          tg-filehost installer         ${NC}"
  echo -e "${BOLD}${CYAN}========================================${NC}"
  echo -e "${BOLD} Telegram bot: send a file → get a direct link.${NC}"
  echo -e "${BOLD}             : send a direct URL → get back the file.${NC}"
  echo -e "${BOLD} Repo:${NC}        ${REPO_URL}"
  echo -e "${BOLD} Install dir:${NC} ${INSTALL_DIR}"
  echo
}

cleanup_existing() {
  step "Cleaning up any previous installation"

  if command -v pm2 >/dev/null 2>&1; then
    pm2 delete "${PROJECT}" >/dev/null 2>&1 || true
    pm2 save --force >/dev/null 2>&1 || true
    ok "PM2 process removed"
  fi

  if [[ -f /etc/nginx/conf.d/${PROJECT}.conf ]]; then
    local backup="/etc/nginx/conf.d/${PROJECT}.conf.bak.$(date +%Y%m%d_%H%M%S)"
    mv "/etc/nginx/conf.d/${PROJECT}.conf" "${backup}"
    warn "Backed up existing nginx conf to ${backup}"
  fi
  if [[ -L /etc/nginx/sites-enabled/${PROJECT} ]]; then
    rm -f "/etc/nginx/sites-enabled/${PROJECT}"
  fi
  if [[ -f /etc/nginx/sites-available/${PROJECT} ]]; then
    rm -f "/etc/nginx/sites-available/${PROJECT}"
  fi

  if [[ -d "${INSTALL_DIR}" ]]; then
    rm -rf "${INSTALL_DIR}"
    ok "Removed ${INSTALL_DIR}"
  fi
}

install_system_deps() {
  step "Installing system dependencies"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl git ca-certificates xz-utils nginx

  if ! command -v node >/dev/null 2>&1 || \
     [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt "${NODE_MAJOR}" ]]; then
    info "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  ok "Node.js $(node -v)"
  ok "npm $(npm -v)"

  if ! command -v pm2 >/dev/null 2>&1; then
    info "Installing PM2 globally"
    npm install -g pm2
  fi
  ok "PM2 $(pm2 -v)"

  if ! pm2 list 2>/dev/null | grep -q "pm2-logrotate"; then
    info "Installing pm2-logrotate"
    pm2 install pm2-logrotate >/dev/null 2>&1 || true
  fi
}

clone_repo() {
  step "Cloning repository"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}/logs"
  ok "Cloned to ${INSTALL_DIR}"
}

prompt_nonempty() {
  local prompt="$1"
  local default="${2:-}"
  local value=""
  while true; do
    if [[ -n "${default}" ]]; then
      read -r -p "$(echo -e "${prompt} [${default}]: ")" value
      value="${value:-${default}}"
    else
      read -r -p "$(echo -e "${prompt}: ")" value
    fi
    if [[ -z "${value// }" ]]; then
      err "Value cannot be empty. Please try again."
      continue
    fi
    echo "${value}"
    return
  done
}

prompt_optional() {
  local prompt="$1"
  local value=""
  read -r -p "$(echo -e "${prompt}: ")" value
  echo "${value}"
}

prompt_numeric() {
  local prompt="$1"
  local default="${2:-}"
  local value=""
  while true; do
    if [[ -n "${default}" ]]; then
      read -r -p "$(echo -e "${prompt} [${default}]: ")" value
      value="${value:-${default}}"
    else
      read -r -p "$(echo -e "${prompt}: ")" value
    fi
    if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
      err "Must be a non-negative integer. Please try again."
      continue
    fi
    echo "${value}"
    return
  done
}

prompt_file() {
  local prompt="$1"
  local value=""
  while true; do
    read -r -p "$(echo -e "${prompt}: ")" value
    if [[ -z "${value// }" ]]; then
      err "Path cannot be empty. Please try again."
      continue
    fi
    if [[ ! -f "${value}" ]]; then
      err "File not found: ${value}"
      continue
    fi
    echo "${value}"
    return
  done
}

prompt_user_ids_with_optional_empty() {
  local prompt="$1"
  local value=""
  while true; do
    read -r -p "$(echo -e "${prompt}: ")" value
    value="${value// /}"
    if [[ -z "${value}" ]]; then
      warn "ALLOWED_USERS is empty — this means the bot will be open to ANY Telegram user."
      local confirm=""
      read -r -p "$(echo -e "${YELLOW}Are you sure? [y/n]: ${NC}")" confirm
      case "${confirm,,}" in
        y|yes) echo ""; return ;;
        *)     err "Please enter at least one Telegram user id."; continue ;;
      esac
    fi
    if [[ ! "${value}" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
      err "Format must be comma-separated user ids, e.g. 123456789,987654321"
      continue
    fi
    echo "${value}"
    return
  done
}

# Common ports reserved by other services we don't want to clash with.
BLOCKED_PORTS=(80 443 1080 2053 2083 2087 2096 8443)

is_blocked_port() {
  local p="$1"
  for bp in "${BLOCKED_PORTS[@]}"; do
    [[ "$p" == "$bp" ]] && return 0
  done
  return 1
}

is_port_in_use() {
  ss -tlnp 2>/dev/null | grep -q ":$1 " && return 0
  return 1
}

prompt_port() {
  local default_port="$1"
  local value=""
  while true; do
    read -r -p "$(echo -e "Internal port for Node.js [${default_port}]: ")" value
    value="${value:-${default_port}}"
    if [[ ! "${value}" =~ ^[0-9]+$ ]] || (( value < 1024 || value > 65535 )); then
      err "Port must be a number between 1024 and 65535."
      continue
    fi
    if is_blocked_port "${value}"; then
      err "Port ${value} is reserved by a common service. Choose another."
      continue
    fi
    if is_port_in_use "${value}"; then
      err "Port ${value} is already in use on this server. Choose another."
      continue
    fi
    echo "${value}"
    return
  done
}

collect_inputs() {
  step "Collecting Telegram configuration"
  echo -e "${YELLOW}All inputs are shown in plain text so you can verify what you typed.${NC}\n"

  echo -e "${BOLD}Bot token${NC} (from @BotFather)"
  BOT_TOKEN=$(prompt_nonempty "BOT_TOKEN")

  echo -e "\n${BOLD}Telegram client app credentials${NC} (https://my.telegram.org/apps)"
  TG_API_ID=$(prompt_numeric "TG_API_ID")
  TG_API_HASH=$(prompt_nonempty "TG_API_HASH")

  echo
  echo -e "${BOLD}Allowed users${NC}"
  echo -e "${CYAN}Comma-separated Telegram numeric user IDs that may use the bot.${NC}"
  echo -e "${CYAN}Tip: send /start to @userinfobot to find your numeric user id.${NC}"
  ALLOWED_USERS=$(prompt_user_ids_with_optional_empty "ALLOWED_USERS")

  step "Collecting domain & SSL"
  echo -e "${BOLD}Host${NC} (e.g. files.example.com — must already point at this server)"
  HOST=$(prompt_nonempty "HOST")

  echo -e "\n${BOLD}Internal port${NC} for the Node backend (Nginx will proxy /health to it)"
  APP_PORT=$(prompt_port 3000)

  echo -e "\n${BOLD}Cloudflare Origin Certificate${NC}"
  echo -e "${CYAN}Tip: in Cloudflare, SSL/TLS -> Origin Server -> Create Certificate.${NC}"
  echo -e "${CYAN}Save the .pem and .key files anywhere on this server, then enter their paths.${NC}"
  SSL_CERT=$(prompt_file "Path to origin .pem file")
  SSL_KEY=$(prompt_file  "Path to origin .key file")
  SSL_DIR=$(dirname "${SSL_CERT}")

  step "Storage"
  echo -e "${BOLD}Upload directory${NC} (where hosted files live on disk and are served by nginx)"
  echo -e "${CYAN}Default lives outside /root so nginx (www-data) can serve it without${NC}"
  echo -e "${CYAN}loosening permissions on your home directory.${NC}"
  UPLOAD_DIR=$(prompt_nonempty "UPLOAD_DIR" "${DEFAULT_UPLOAD_DIR}")

  echo -e "\n${BOLD}Temp directory${NC} (used while downloading files from URLs before sending to chat)"
  TEMP_DIR=$(prompt_nonempty "TEMP_DIR" "${DEFAULT_TEMP_DIR}")

  MAX_FILE_MB=$(prompt_numeric "Max file size accepted from Telegram (MB)" "2048")
  MAX_DOWNLOAD_MB=$(prompt_numeric "Max file size accepted from URL downloads (MB)" "2048")

  echo
  echo -e "${BOLD}Retention${NC} (auto-delete hosted files after N days)"
  echo -e "${CYAN}Enter 0 to keep files forever.${NC}"
  RETENTION_DAYS=$(prompt_numeric "RETENTION_DAYS" "0")
}

confirm_inputs() {
  step "Configuration summary"
  cat <<EOF
  Host           : ${HOST}
  Files URL      : https://${HOST}/files/
  Internal port  : ${APP_PORT}
  SSL cert       : ${SSL_CERT}
  SSL key        : ${SSL_KEY}
  Install dir    : ${INSTALL_DIR}
  Upload dir     : ${UPLOAD_DIR}
  Temp dir       : ${TEMP_DIR}
  Max upload     : ${MAX_FILE_MB} MB (Telegram → link)
  Max URL fetch  : ${MAX_DOWNLOAD_MB} MB (URL → Telegram)
  Retention      : ${RETENTION_DAYS} day(s) ($([[ "${RETENTION_DAYS}" == "0" ]] && echo 'keep forever' || echo "delete after ${RETENTION_DAYS}d"))
  Allowed users  : ${ALLOWED_USERS:-<none — open to all>}
EOF
  echo
  while true; do
    read -r -p "$(echo -e "${YELLOW}Proceed with installation? [y/n]: ${NC}")" yn
    case "${yn,,}" in
      y|yes) return ;;
      n|no)  echo "Cancelled."; exit 0 ;;
      *)     err "Please answer y or n." ;;
    esac
  done
}

write_env() {
  step "Writing .env"

  cat >"${INSTALL_DIR}/.env" <<EOF
BOT_TOKEN=${BOT_TOKEN}
TG_API_ID=${TG_API_ID}
TG_API_HASH=${TG_API_HASH}
TG_SESSION_FILE=${INSTALL_DIR}/telegram.session
ALLOWED_USERS=${ALLOWED_USERS}
HOST=${HOST}
PORT=${APP_PORT}
UPLOAD_DIR=${UPLOAD_DIR}
TEMP_DIR=${TEMP_DIR}
MAX_FILE_MB=${MAX_FILE_MB}
MAX_DOWNLOAD_MB=${MAX_DOWNLOAD_MB}
RETENTION_DAYS=${RETENTION_DAYS}
LOG_LEVEL=info
NODE_ENV=production
EOF

  chmod 600 "${INSTALL_DIR}/.env"
  ok ".env written (chmod 600)"
}

install_npm_deps() {
  step "Installing Node.js dependencies"
  ( cd "${INSTALL_DIR}" && npm install --omit=dev --no-audit --no-fund )
  ok "Packages installed"
}

prepare_runtime_dirs() {
  step "Preparing storage directories"
  mkdir -p "${UPLOAD_DIR}" "${TEMP_DIR}"
  chmod 755 "${UPLOAD_DIR}" "${TEMP_DIR}"
  case "${UPLOAD_DIR}" in
    /root*)
      warn "UPLOAD_DIR is under /root. Adding traversal permission (chmod o+x /root)."
      warn "Using /var/lib/${PROJECT}/files is recommended; consider moving it."
      chmod o+x /root
      ;;
  esac
  ok "Upload dir : ${UPLOAD_DIR}"
  ok "Temp dir   : ${TEMP_DIR}"
}

build_ssl_fullchain() {
  step "Building SSL fullchain"
  curl -fsSL https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem \
    -o "${SSL_DIR}/cloudflare_origin_ca.pem"
  cat "${SSL_CERT}" "${SSL_DIR}/cloudflare_origin_ca.pem" > "${SSL_DIR}/fullchain.pem"
  chmod 600 "${SSL_KEY}"
  ok "fullchain.pem written to ${SSL_DIR}/fullchain.pem"
}

write_nginx_conf() {
  step "Configuring Nginx"
  local target="/etc/nginx/conf.d/${PROJECT}.conf"

  sed \
    -e "s|__HOST__|${HOST}|g" \
    -e "s|__SSL_FULLCHAIN__|${SSL_DIR}/fullchain.pem|g" \
    -e "s|__SSL_KEY__|${SSL_KEY}|g" \
    -e "s|__UPLOAD_DIR__|${UPLOAD_DIR}|g" \
    -e "s|__PORT__|${APP_PORT}|g" \
    "${INSTALL_DIR}/nginx/${PROJECT}.conf" > "${target}"

  if ! nginx -t 2>/dev/null; then
    err "nginx -t failed; aborting."
    rm -f "${target}"
    exit 1
  fi
  systemctl reload nginx
  ok "Nginx config written to ${target}"
}

start_pm2() {
  step "Starting backend with PM2"
  ( cd "${INSTALL_DIR}" && pm2 start ecosystem.config.cjs )
  pm2 save
  pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash || true
  ok "PM2 started"
}

print_done() {
  echo
  echo -e "${GREEN}${BOLD}========================================${NC}"
  echo -e "${GREEN}${BOLD}     tg-filehost is ready!              ${NC}"
  echo -e "${GREEN}${BOLD}========================================${NC}"
  echo -e "  Files URL   : https://${HOST}/files/"
  echo -e "  Health      : https://${HOST}/health"
  echo -e "  Upload dir  : ${UPLOAD_DIR}"
  echo -e "  Temp dir    : ${TEMP_DIR}"
  echo -e "  Install dir : ${INSTALL_DIR}"
  echo
  echo -e "  Useful commands:"
  echo -e "    pm2 status"
  echo -e "    pm2 logs ${PROJECT}"
  echo -e "    pm2 restart ${PROJECT}"
  echo -e "    bash ${INSTALL_DIR}/update.sh"
  echo -e "    bash ${INSTALL_DIR}/uninstall.sh"
  echo
  echo -e "  Open the bot in Telegram and:"
  echo -e "    - send a file        → you'll get back a direct download link"
  echo -e "    - send a direct URL  → you'll get back the file as a Telegram document"
  echo
}

main() {
  require_root
  banner
  cleanup_existing
  install_system_deps
  clone_repo
  collect_inputs
  confirm_inputs
  write_env
  install_npm_deps
  prepare_runtime_dirs
  build_ssl_fullchain
  write_nginx_conf
  start_pm2
  print_done
}

main "$@"
