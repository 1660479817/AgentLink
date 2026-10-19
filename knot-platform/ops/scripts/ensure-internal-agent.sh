#!/usr/bin/env bash
# 确保一个 Internal Personal Agent。可重复执行，不换已有授权码。
# 用法：./ops/scripts/ensure-internal-agent.sh 豆包
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "用法：./ops/scripts/ensure-internal-agent.sh <称呼>" >&2
  exit 1
fi

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
if [[ ! -f "$KNOT_PLATFORM_ENV" ]]; then
  echo "缺少 $KNOT_PLATFORM_ENV。先跑 ./ops/scripts/deploy-site.sh --site $KNOT_SITE。" >&2
  exit 1
fi
knot_source_platform_env

exec node "$KNOT_HOME/backend/scripts/ensure-internal-agent.mjs" "$NAME"
