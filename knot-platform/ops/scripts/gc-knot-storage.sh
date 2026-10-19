#!/usr/bin/env bash
# 每月跑一次存储回收的报告，不删任何东西。真正要删时人工加 --apply。
#
# 手动执行：
#   cd <仓库目录> && ./ops/scripts/gc-knot-storage.sh
# 定时执行由 ops/launchd/com.knot.gc.plist 负责（每月 1 日 04:45）。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
knot_source_platform_env

cd "$KNOT_HOME"
exec node backend/scripts/gc-uploads.mjs "$@"
