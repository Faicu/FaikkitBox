#!/usr/bin/env bash
set -euo pipefail

cd /opt/faikkitbox

BRANCH="${DEPLOY_BRANCH:-main}"

echo "[deploy] $(date -Is) — verific ${BRANCH}..."

git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/${BRANCH}")

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[deploy] nimic nou."
  exit 0
fi

echo "[deploy] schimbări detectate ($LOCAL -> $REMOTE), actualizez..."
git checkout "$BRANCH" --quiet
git reset --hard "origin/${BRANCH}" --quiet

echo "[deploy] rebuild + restart container..."
docker compose up -d --build

echo "[deploy] gata: $(git rev-parse --short HEAD)"
