#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/root/tg-filehost"

cd "$INSTALL_DIR"

echo -e "${GREEN}${BOLD}[1/3] Pulling latest changes...${NC}"
git pull

echo -e "${GREEN}${BOLD}[2/3] Installing dependencies...${NC}"
npm install --omit=dev

echo -e "${GREEN}${BOLD}[3/3] Restarting application...${NC}"
pm2 restart tg-filehost

echo -e "${GREEN}${BOLD}\u2713 tg-filehost updated successfully.${NC}"
