#!/usr/bin/env bash
# tg-filehost installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-filehost/main/install.sh)

set -euo pipefail

REPO_URL="https://github.com/ali934h/tg-filehost.git"
PROJECT="tg-filehost"
INSTALL_DIR="/root/${PROJECT}"
DEFAULT_UPLOAD_DIR="/var/lib/${PROJECT}/files"
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
  echo -e "${BOLD} Telegram userbot that turns files into direct download links${NC}"
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
      err "Must be a positive integer. Please try again."
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

  echo -e "${BOLD}Telegram API credentials${NC} (https://my.telegram.org/apps)"
  API_ID=$(prompt_numeric "API_ID")
  API_HASH=$(prompt_nonempty "API_HASH")
  PHONE=$(prompt_nonempty "Phone number (e.g. +989123456789)")

  echo
  echo -e "${BOLD}Allowed users${NC}"
  echo -e "${CYAN}Comma-separated Telegram numeric user IDs that may use the bot.${NC}"
  echo -e "${CYAN}If you also set ALLOWED_CHATS below, the chat list takes precedence.${NC}"
  ALLOWED_USERS=$(prompt_nonempty "ALLOWED_USERS")

  echo
  echo -e "${BOLD}Allowed chats (optional)${NC}"
  echo -e "${CYAN}Comma-separated chat/channel IDs (e.g. -100123456789). Leave empty to skip.${NC}"
  ALLOWED_CHATS=$(prompt_optional "ALLOWED_CHATS")

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
  echo -e "${BOLD}Upload directory${NC} (where files are stored on disk)"
  echo -e "${CYAN}Default lives outside /root so nginx (www-data) can serve it without${NC}"
  echo -e "${CYAN}loosening permissions on your home directory.${NC}"
  UPLOAD_DIR=$(prompt_nonempty "UPLOAD_DIR" "${DEFAULT_UPLOAD_DIR}")

  MAX_FILE_MB=$(prompt_numeric "Maximum allowed file size in MB" "2048")
}

confirm_inputs() {
  step "Configuration summary"
  cat <<EOF
  Host          : ${HOST}
  Files URL     : https://${HOST}/files/
  Internal port : ${APP_PORT}
  SSL cert      : ${SSL_CERT}
  SSL key       : ${SSL_KEY}
  Install dir   : ${INSTALL_DIR}
  Upload dir    : ${UPLOAD_DIR}
  Max file size : ${MAX_FILE_MB} MB
  Allowed users : ${ALLOWED_USERS}
  Allowed chats : ${ALLOWED_CHATS:-<none>}
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
API_ID=${API_ID}
API_HASH=${API_HASH}
PHONE=${PHONE}
SESSION=
ALLOWED_USERS=${ALLOWED_USERS}
ALLOWED_CHATS=${ALLOWED_CHATS}
HOST=${HOST}
PORT=${APP_PORT}
UPLOAD_DIR=${UPLOAD_DIR}
MAX_FILE_MB=${MAX_FILE_MB}
LOG_LEVEL=info
EOF

  chmod 600 "${INSTALL_DIR}/.env"
  ok ".env written (chmod 600)"
}

install_npm_deps() {
  step "Installing Node.js dependencies"
  ( cd "${INSTALL_DIR}" && npm install --omit=dev --no-audit --no-fund )
  ok "Packages installed"
}

prepare_upload_dir() {
  step "Preparing upload directory"
  mkdir -p "${UPLOAD_DIR}"
  # Ensure nginx (www-data) can read the files. We do NOT touch /root —
  # the default UPLOAD_DIR lives under /var/lib so this is unnecessary.
  # If the user picked a path under /root, warn them and add traversal.
  chmod 755 "${UPLOAD_DIR}"
  case "${UPLOAD_DIR}" in
    /root*)
      warn "UPLOAD_DIR is under /root. Adding traversal permission (chmod o+x /root)."
      warn "This is less safe than using /var/lib/${PROJECT}/files; consider moving it."
      chmod o+x /root
      ;;
  esac
  ok "Upload directory ready: ${UPLOAD_DIR}"
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

telegram_login() {
  step "Telegram login (one-time)"
  echo -e "${YELLOW}A verification code will be sent to your Telegram account.${NC}"
  echo -e "${YELLOW}Setup will write the resulting session into .env automatically.${NC}\n"

  ( cd "${INSTALL_DIR}" && node setup.js )

  if ! grep -q "^SESSION=." "${INSTALL_DIR}/.env"; then
    err "SESSION was not saved. Run 'cd ${INSTALL_DIR} && node setup.js' to retry."
    exit 1
  fi
  ok "Session saved"
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
  echo -e "  Files URL  : https://${HOST}/files/"
  echo -e "  Health     : https://${HOST}/health"
  echo -e "  Upload dir : ${UPLOAD_DIR}"
  echo -e "  Install dir: ${INSTALL_DIR}"
  echo
  echo -e "  Useful commands:"
  echo -e "    pm2 status"
  echo -e "    pm2 logs ${PROJECT}"
  echo -e "    pm2 restart ${PROJECT}"
  echo -e "    bash ${INSTALL_DIR}/update.sh"
  echo -e "    bash ${INSTALL_DIR}/uninstall.sh"
  echo
  echo -e "  Send any file to your bot account in Telegram and you'll get back"
  echo -e "  a direct download link. See README.md for the full command list."
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
  prepare_upload_dir
  build_ssl_fullchain
  write_nginx_conf
  telegram_login
  start_pm2
  print_done
}

main "$@"
