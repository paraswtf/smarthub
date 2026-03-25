#!/bin/sh
set -e

git config --global --add safe.directory /repo

echo "[redeploy] Pulling latest changes..."
cd /repo
git pull origin main

echo "[redeploy] Rebuilding app containers..."
docker compose -p home-automation up --build -d nextjs wsserver

echo "[redeploy] Done."
