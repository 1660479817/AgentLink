#!/usr/bin/env bash
# 每月跑一次存储回收的报告，不删任何东西。真正要删时人工加 --apply。
#
# 手动执行：
#   cd <仓库目录> && ./ops/scripts/gc-knot-storage.sh
# 定时执行由 ops/launchd/com.knot.gc.plist 负责（每月 1 日 04:45）。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${KNOT_ENV:-$KNOT_HOME/ops/env/knot-platform.local.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

cd "$KNOT_HOME"
exec node apps/knot-platform/scripts/gc-uploads.mjs "$@"
