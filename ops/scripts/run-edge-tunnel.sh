#!/bin/bash
# bot01 主动连出，把云端 127.0.0.1:18080 转到本机 Knot Backend。
# 云端 127.0.0.1:8080 是另一套站点，不能占用。
set -euo pipefail
KEY="${KNOT_EDGE_KEY:-$HOME/.ssh/knot-edge}"
HOST="${KNOT_EDGE_HOST:-knot-tunnel@16.162.24.182}"
exec /usr/bin/ssh -N \
  -i "$KEY" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -R 127.0.0.1:18080:127.0.0.1:8080 \
  "$HOST"
