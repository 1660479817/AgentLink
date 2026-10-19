#!/usr/bin/env bash
# 把已构建的 dist 同步到静态托管目录。
#
# 这一步是可选的：门户在本机就能构建和预览，不需要先部署。
# 目标机器和目录都通过环境变量给出，脚本里不写死任何主机。
#
# 用法：
#   XKNOT_EDGE=user@host ./ops/deploy-hub.sh
#   XKNOT_EDGE=user@host XKNOT_TARGET=/var/www/xknot ./ops/deploy-hub.sh --dry-run
#
# 可覆盖的变量：
#   XKNOT_EDGE      必填，如 user@192.0.2.10
#   XKNOT_TARGET    远端目录，默认 /var/www/xknot
#   XKNOT_SSH_KEY   私钥路径，默认 ~/.ssh/id_rsa

set -euo pipefail

HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$HUB/web/dist"

if [ ! -f "$DIST/index.html" ]; then
  echo "dist is missing; run ./ops/build-hub.sh first" >&2
  exit 1
fi

: "${XKNOT_EDGE:?set XKNOT_EDGE=user@host}"
TARGET="${XKNOT_TARGET:-/var/www/xknot}"
KEY="${XKNOT_SSH_KEY:-$HOME/.ssh/id_rsa}"

RSYNC_ARGS=(-az --delete --itemize-changes
  --exclude .well-known
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new")

if [ "${1:-}" = "--dry-run" ]; then
  RSYNC_ARGS+=(--dry-run)
fi

echo "== deploy =="
echo "$DIST/ -> $XKNOT_EDGE:$TARGET/"
rsync "${RSYNC_ARGS[@]}" "$DIST/" "$XKNOT_EDGE:$TARGET/"
