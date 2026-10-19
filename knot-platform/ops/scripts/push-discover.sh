#!/usr/bin/env bash
# 把发现页公开快照推到云端边缘的 WebUI 目录。
#
# 平台在内容变化后调用它。目标与路径来自 ops/deploy.env：
#   KNOT_EDGE=1
#   KNOT_EDGE_SSH=user@edge-host
#   KNOT_EDGE_WEB_ROOT=/var/www/knot
#
# 用法：push-discover.sh /path/to/board
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/deploy-config.sh
source "$SCRIPT_DIR/lib/deploy-config.sh"

BOARD="${1:?board directory}"

if ! knot_enabled KNOT_EDGE; then
  # 没有 deploy.env 的旧机器只在进程环境里给了 KNOT_EDGE_SSH，继续按旧行为推。
  if [[ -f "$KNOT_DEPLOY_ENV" || -z "${KNOT_EDGE_SSH:-}" ]]; then
    echo "KNOT_EDGE 未开启，快照只留在 $BOARD"
    exit 0
  fi
fi
knot_require KNOT_EDGE_SSH "在 ops/deploy.env 里配置 KNOT_EDGE_SSH=user@edge-host。"

if [[ ! -f "$BOARD/discover.json" ]]; then
  echo "missing $BOARD/discover.json" >&2
  exit 1
fi

SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
# 平台主机用 KNOT_EDGE_PUSH_KEY；旧机器把它写在环境文件的 KNOT_EDGE_SSH_KEY 里。
# KNOT_EDGE_PUSH_KEY 有默认路径，所以默认路径不存在时再退回旧键。
EDGE_KEY="$(knot_expand_path "${KNOT_EDGE_PUSH_KEY:-}")"
if [[ ! -f "$EDGE_KEY" && -n "${KNOT_EDGE_SSH_KEY:-}" ]]; then
  EDGE_KEY="$(knot_expand_path "$KNOT_EDGE_SSH_KEY")"
fi
if [[ -n "$EDGE_KEY" ]]; then
  SSH_OPTS+=(-i "$EDGE_KEY")
fi

mkdir -p "$BOARD/media/previews"
rsync -az -e "ssh ${SSH_OPTS[*]}" "$BOARD/discover.json" "$KNOT_EDGE_SSH:/tmp/knot-discover.json"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$BOARD/media/previews/" "$KNOT_EDGE_SSH:/tmp/knot-previews/"

CHOWN_CMD=""
if [[ -n "$KNOT_EDGE_WEB_OWNER" ]]; then
  CHOWN_CMD="sudo chown -R $KNOT_EDGE_WEB_OWNER '$KNOT_EDGE_WEB_ROOT/discover.json' '$KNOT_EDGE_WEB_ROOT/media' &&"
fi

ssh "${SSH_OPTS[@]}" "$KNOT_EDGE_SSH" "
  set -e
  sudo mkdir -p '$KNOT_EDGE_WEB_ROOT/media/previews'
  sudo cp /tmp/knot-discover.json '$KNOT_EDGE_WEB_ROOT/discover.json'
  sudo rsync -a --delete /tmp/knot-previews/ '$KNOT_EDGE_WEB_ROOT/media/previews/'
  $CHOWN_CMD true
"

echo "OK: discover snapshot"
