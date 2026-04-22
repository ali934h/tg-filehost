#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/root/tg-filehost"
NGINX_CONF="/etc/nginx/conf.d/tg-filehost.conf"

echo -e "${YELLOW}${BOLD}This will completely remove tg-filehost from this server.${NC}"
echo -e "${YELLOW}Install dir : ${INSTALL_DIR}${NC}"
echo -e "${YELLOW}Nginx conf  : ${NGINX_CONF}${NC}"
echo ""

read -rp "$(echo -e ${RED}"Are you sure? [y/n]: "${NC})" CONFIRM
case "$CONFIRM" in
  y|Y) ;;
  *) echo -e "\n${YELLOW}Uninstall cancelled.${NC}" && exit 0 ;;
esac

echo -e "\n${GREEN}${BOLD}[1/3] Removing PM2 process...${NC}"
if command -v pm2 &>/dev/null; then
  pm2 delete tg-filehost 2>/dev/null || true
  pm2 save --force 2>/dev/null || true
  echo -e "  ${GREEN}\u2713 PM2 process removed.${NC}"
else
  echo -e "  ${YELLOW}PM2 not found, skipping.${NC}"
fi

echo -e "\n${GREEN}${BOLD}[2/3] Removing Nginx config...${NC}"
if [[ -f "$NGINX_CONF" ]]; then
  sudo rm -f "$NGINX_CONF"
  sudo systemctl reload nginx 2>/dev/null || true
  echo -e "  ${GREEN}\u2713 Nginx config removed and nginx reloaded.${NC}"
else
  echo -e "  ${YELLOW}Nginx config not found, skipping.${NC}"
fi

echo -e "\n${GREEN}${BOLD}[3/3] Removing install directory...${NC}"
if [[ -d "$INSTALL_DIR" ]]; then
  sudo rm -rf "$INSTALL_DIR"
  echo -e "  ${GREEN}\u2713 ${INSTALL_DIR} removed.${NC}"
else
  echo -e "  ${YELLOW}Install directory not found, skipping.${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}\u2713 tg-filehost uninstalled successfully.${NC}"
