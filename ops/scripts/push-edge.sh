#!/usr/bin/env bash
# 把 Knot WebUI 推到 knot.zenheart.net。平台仍在 bot01，/api 经隧道回来。
# 用法：./ops/scripts/push-edge.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EDGE="${KNOT_EDGE_SSH:-ec2-user@16.162.24.182}"
EDGE_KEY="${KNOT_EDGE_SSH_KEY:-$HOME/.ssh/id_rsa}"
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$EDGE_KEY")

echo "==> build web"
npm run build -w web --prefix "$ROOT"

echo "==> sync dist and nginx"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  "$ROOT/apps/web/dist/" "$EDGE:/tmp/knot-web/"
scp "${SSH_OPTS[@]}" "$ROOT/ops/edge/knot.zenheart.net.conf" "$EDGE:/tmp/knot.zenheart.net.conf"

echo "==> install site"
ssh "${SSH_OPTS[@]}" "$EDGE" "sudo mkdir -p /var/www/knot && sudo rsync -a --delete --exclude .well-known /tmp/knot-web/ /var/www/knot/ && sudo chown -R nginx:nginx /var/www/knot && sudo cp /tmp/knot.zenheart.net.conf /etc/nginx/conf.d/knot.zenheart.net.conf && sudo nginx -t && sudo systemctl reload nginx"

echo "OK: https://knot.zenheart.net/"
