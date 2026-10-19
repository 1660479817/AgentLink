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
ENV_FILE="${KNOT_ENV:-$KNOT_HOME/ops/env/knot-platform.local.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

exec node "$KNOT_HOME/backend/scripts/ensure-internal-agent.mjs" "$NAME"
