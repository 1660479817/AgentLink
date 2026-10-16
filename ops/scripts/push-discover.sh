#!/usr/bin/env bash
# 把发现页公开快照推到 knot.zenheart.net 的 WebUI 目录。
# 平台在内容变化后调用它。bot01 上设置：
#   KNOT_DISCOVER_PUSH_CMD=/path/to/ops/scripts/push-discover.sh
# 用法：push-discover.sh /path/to/board
set -euo pipefail

BOARD="${1:?board directory}"
EDGE="${KNOT_EDGE_SSH:-ec2-user@16.162.24.182}"
EDGE_KEY="${KNOT_EDGE_SSH_KEY:-$HOME/.ssh/id_rsa}"
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$EDGE_KEY")

if [[ ! -f "$BOARD/discover.json" ]]; then
  echo "missing $BOARD/discover.json" >&2
  exit 1
fi

mkdir -p "$BOARD/media/previews"
rsync -az -e "ssh ${SSH_OPTS[*]}" "$BOARD/discover.json" "$EDGE:/tmp/knot-discover.json"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$BOARD/media/previews/" "$EDGE:/tmp/knot-previews/"
ssh "${SSH_OPTS[@]}" "$EDGE" "sudo mkdir -p /var/www/knot/media/previews && sudo cp /tmp/knot-discover.json /var/www/knot/discover.json && sudo rsync -a --delete /tmp/knot-previews/ /var/www/knot/media/previews/ && sudo chown -R nginx:nginx /var/www/knot/discover.json /var/www/knot/media"

echo "OK: discover snapshot"
