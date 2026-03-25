#!/bin/sh
set -e

LOCKFILE="/tmp/redeploy.pid"

# Kill previous redeploy if still running
if [ -f "$LOCKFILE" ]; then
    OLD_PID=$(cat "$LOCKFILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[redeploy] Killing previous deploy (PID $OLD_PID)..."
        kill -- -"$OLD_PID" 2>/dev/null || kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi
fi

# Write our PID
echo $$ > "$LOCKFILE"

git config --global --add safe.directory /repo

echo "[redeploy] Pulling latest changes..."
cd /repo
git pull origin main

echo "[redeploy] Rebuilding app containers..."
docker compose -p home-automation up --build -d nextjs wsserver

echo "[redeploy] Done."
rm -f "$LOCKFILE"
