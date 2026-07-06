#!/usr/bin/env bash
set -euo pipefail

cd /opt/faikkitbox

SERVICE="${DEPLOY_SERVICE:-faikkitbox}"

echo "[deploy] $(date -Is) — verific main..."

git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[deploy] nimic nou."
  exit 0
fi

echo "[deploy] schimbări detectate ($LOCAL -> $REMOTE), actualizez..."
git checkout main --quiet
git reset --hard origin/main --quiet

echo "[deploy] instalez dependinte + build..."
npm install
npm run build

# Asigură existența directorului pentru log-ul de descărcări (înainte de restart)
sudo mkdir -p /opt/faikkitbox/data
sudo chown faicu:faicu /opt/faikkitbox/data 2>/dev/null || true

echo "[deploy] restart serviciu systemd..."
sudo systemctl restart "$SERVICE"

echo "[deploy] gata: $(git rev-parse --short HEAD)"
