#!/usr/bin/env bash
# Stop and remove tg-filehost from this server.

set -euo pipefail

INSTALL_DIR="/root/tg-filehost"
NGINX_CONF="/etc/nginx/conf.d/tg-filehost.conf"
DEFAULT_UPLOAD_DIR="/var/lib/tg-filehost/files"
DEFAULT_TEMP_DIR="/var/lib/tg-filehost/temp"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

UPLOAD_DIR=""
TEMP_DIR=""
if [[ -f "${INSTALL_DIR}/.env" ]]; then
  UPLOAD_DIR=$(grep -E "^UPLOAD_DIR=" "${INSTALL_DIR}/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)
  TEMP_DIR=$(grep -E "^TEMP_DIR=" "${INSTALL_DIR}/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)
fi
UPLOAD_DIR=${UPLOAD_DIR:-${DEFAULT_UPLOAD_DIR}}
TEMP_DIR=${TEMP_DIR:-${DEFAULT_TEMP_DIR}}

echo -e "${YELLOW}${BOLD}This will remove tg-filehost from this server.${NC}"
echo -e "  Install dir : ${INSTALL_DIR}"
echo -e "  Nginx conf  : ${NGINX_CONF}"
echo -e "  Upload dir  : ${UPLOAD_DIR} (asked before removal)"
echo -e "  Temp dir    : ${TEMP_DIR} (always cleared)"
echo

read -r -p "$(echo -e "${RED}Continue? [y/n]: ${NC}")" CONFIRM
case "${CONFIRM,,}" in
  y|yes) ;;
  *) echo -e "\n${YELLOW}Cancelled.${NC}"; exit 0 ;;
esac

echo -e "\n${GREEN}${BOLD}[1/5] Removing PM2 process...${NC}"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete tg-filehost >/dev/null 2>&1 || true
  pm2 save --force >/dev/null 2>&1 || true
  echo -e "  PM2 process removed."
else
  echo -e "  PM2 not found, skipping."
fi

echo -e "\n${GREEN}${BOLD}[2/5] Removing Nginx config...${NC}"
if [[ -f "${NGINX_CONF}" ]]; then
  rm -f "${NGINX_CONF}"
  systemctl reload nginx 2>/dev/null || true
  echo -e "  Nginx config removed and nginx reloaded."
else
  echo -e "  Nginx config not found, skipping."
fi

echo -e "\n${GREEN}${BOLD}[3/5] Removing install directory...${NC}"
if [[ -d "${INSTALL_DIR}" ]]; then
  rm -rf "${INSTALL_DIR}"
  echo -e "  ${INSTALL_DIR} removed."
else
  echo -e "  Install directory not found, skipping."
fi

echo -e "\n${GREEN}${BOLD}[4/5] Clearing temp directory...${NC}"
if [[ -d "${TEMP_DIR}" ]]; then
  rm -rf "${TEMP_DIR}"
  echo -e "  ${TEMP_DIR} removed."
else
  echo -e "  No temp directory at ${TEMP_DIR}, skipping."
fi

echo -e "\n${GREEN}${BOLD}[5/5] Upload directory${NC}"
if [[ -d "${UPLOAD_DIR}" ]]; then
  echo -e "  ${YELLOW}Upload directory still exists: ${UPLOAD_DIR}${NC}"
  read -r -p "$(echo -e "${RED}Delete uploaded files too? [y/n]: ${NC}")" YN
  case "${YN,,}" in
    y|yes)
      rm -rf "${UPLOAD_DIR}"
      echo -e "  ${UPLOAD_DIR} removed."
      ;;
    *)
      echo -e "  Kept ${UPLOAD_DIR}."
      ;;
  esac
else
  echo -e "  No upload directory at ${UPLOAD_DIR}, skipping."
fi

echo
echo -e "${GREEN}${BOLD}tg-filehost uninstalled.${NC}"
