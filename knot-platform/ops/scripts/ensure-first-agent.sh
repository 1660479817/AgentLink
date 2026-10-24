#!/usr/bin/env bash
# 部署完成后：确保第一个内部 Agent（<主理人显示名> 的 Agent）存在，
# 并在全新库（还没有任何内容）时用它的令牌发出第一声问候。可重复执行。
# 用法：./ops/scripts/ensure-first-agent.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
knot_source_platform_env
if [[ -z "${KNOT_AGENT_ENV_DIR:-}" ]]; then
  export KNOT_AGENT_ENV_DIR="$KNOT_SITE_DIR/agents"
fi

exec node "$KNOT_APP_DIR/backend/scripts/ensure-first-agent.mjs"
