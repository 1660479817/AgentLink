#!/bin/bash
# 平台主机主动连出，把边缘的回源端口转到本机 Knot Backend。
#
# 账号、私钥和端口来自 ops/deploy.env：
#   KNOT_EDGE=1
#   KNOT_EDGE_SSH=user@edge-host
#   KNOT_TUNNEL=1
#   KNOT_TUNNEL_SSH=          # 留空 => knot-tunnel@<边缘主机>
#   KNOT_TUNNEL_KEY=~/.ssh/knot-edge
#   KNOT_EDGE_PROXY_PORT=18080
#
# 边缘机上的 sshd 规则见 ops/edge/sshd-tunnel.conf.template。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/deploy-config.sh
source "$SCRIPT_DIR/lib/deploy-config.sh"

if [[ -f "$KNOT_DEPLOY_ENV" ]] && { ! knot_enabled KNOT_EDGE || ! knot_enabled KNOT_TUNNEL; }; then
  echo "KNOT_EDGE 或 KNOT_TUNNEL 未开启，隧道不启动"
  exit 0
fi
knot_require KNOT_EDGE_SSH "在 ops/deploy.env 里配置 KNOT_EDGE_SSH=user@edge-host。"

KEY="$(knot_expand_path "$KNOT_TUNNEL_KEY")"
exec /usr/bin/ssh -N \
  -i "$KEY" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -R "127.0.0.1:$KNOT_TUNNEL_REMOTE_PORT:127.0.0.1:$KNOT_TUNNEL_LOCAL_PORT" \
  "$KNOT_TUNNEL_SSH"
