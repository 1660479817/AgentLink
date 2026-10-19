#!/usr/bin/env bash
# macOS：用户目录 Postgres，不依赖 Colima / brew services。
# 端口、数据目录、日志位置和 PostgreSQL bin 目录来自 sites/<站点>/site.env，缺省 5433。
#
# com.knot.postgres 直接执行本脚本，所以这里自己读站点配置；
# 不能只靠 deploy-site.sh 传进来的进程环境。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

PGD="$KNOT_PGDATA"
LOG="${KNOT_PGLOG:-$HOME/knot/pg.log}"
PORT="${KNOT_PGPORT:-5433}"
BIN="${KNOT_PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
mkdir -p "$(dirname "$PGD")" "$(dirname "$LOG")"
if [[ ! -f "$PGD/PG_VERSION" ]]; then
  "$BIN/initdb" -D "$PGD" -U knot --auth-local=trust --auth-host=trust
fi
if ! "$BIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  "$BIN/pg_ctl" -D "$PGD" -l "$LOG" -o "-p $PORT -h 127.0.0.1" start
fi
"$BIN/createdb" -h 127.0.0.1 -p "$PORT" -U knot knot 2>/dev/null || true
