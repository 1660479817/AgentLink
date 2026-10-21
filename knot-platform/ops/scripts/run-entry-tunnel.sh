#!/bin/bash
# 实例主机主动连出，把入口的回源端口转到本机 Knot Backend。
#
# 账号、私钥和端口来自 sites/<站点>/site.env：
#   KNOT_ENTRY_ENABLED=1
#   KNOT_ENTRY_SSH=user@entry-host
#   KNOT_TUNNEL=1
#   KNOT_TUNNEL_SSH=          # 留空 => knot-tunnel@<入口主机>
#   KNOT_TUNNEL_KEY=~/.ssh/knot-entry
#   KNOT_ENTRY_PROXY_PORT=18080
#
# 入口主机上的 sshd 规则见 ops/entry/sshd-tunnel.conf.template。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

if ! knot_enabled KNOT_ENTRY_ENABLED || ! knot_enabled KNOT_TUNNEL; then
  echo "KNOT_ENTRY_ENABLED 或 KNOT_TUNNEL 未开启，隧道不启动"
  exit 0
fi
knot_require KNOT_ENTRY_SSH "在 sites/$KNOT_SITE/site.env 里配置 KNOT_ENTRY_SSH=user@entry-host。"

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
