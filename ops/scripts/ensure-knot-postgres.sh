#!/usr/bin/env bash
# macOS：用户目录 Postgres（5433），不依赖 Colima / brew services
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PGD="${KNOT_PGDATA:-$HOME/knot/pgdata}"
LOG="${KNOT_PGLOG:-$HOME/knot/pg.log}"
BIN="/opt/homebrew/opt/postgresql@16/bin"
mkdir -p "$(dirname "$PGD")" "$(dirname "$LOG")"
if [[ ! -f "$PGD/PG_VERSION" ]]; then
  "$BIN/initdb" -D "$PGD" -U knot --auth-local=trust --auth-host=trust
fi
if ! "$BIN/pg_isready" -h 127.0.0.1 -p 5433 >/dev/null 2>&1; then
  "$BIN/pg_ctl" -D "$PGD" -l "$LOG" -o "-p 5433 -h 127.0.0.1" start
fi
"$BIN/createdb" -h 127.0.0.1 -p 5433 -U knot knot 2>/dev/null || true
