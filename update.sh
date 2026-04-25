#!/usr/bin/env bash
# Pull the latest code, install deps, and restart PM2.

set -euo pipefail

INSTALL_DIR="/root/tg-filehost"

GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

cd "${INSTALL_DIR}"

echo -e "${GREEN}${BOLD}[1/3] Pulling latest changes...${NC}"
git pull --ff-only

echo -e "${GREEN}${BOLD}[2/3] Installing dependencies...${NC}"
npm install --omit=dev --no-audit --no-fund

echo -e "${GREEN}${BOLD}[3/3] Restarting application...${NC}"
pm2 restart tg-filehost
pm2 save

echo -e "${GREEN}${BOLD}\xe2\x9c\x93 tg-filehost updated successfully.${NC}"
