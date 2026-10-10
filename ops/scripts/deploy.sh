#!/usr/bin/env bash
set -euo pipefail

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$KNOT_HOME"

echo "==> npm ci"
npm ci

echo "==> build web"
npm run build -w web

echo "==> postgres (docker)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres

echo "==> migrate"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if npm run migrate; then
    break
  fi
  echo "waiting for postgres..."
  sleep 2
done

if systemctl is-active --quiet knot-platform 2>/dev/null; then
  echo "==> restart systemd services"
  sudo systemctl restart knot-platform openclaw-agent
else
  echo "systemd not active; start manually or run: ops/scripts/install-systemd.sh"
fi

echo "==> health"
curl -sf "http://127.0.0.1:8080/api/health" && echo

echo "Deploy finished. Web via nginx: http://192.168.3.91/"
