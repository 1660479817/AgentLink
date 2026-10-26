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
# 本机库的口令。实例主机常常是多人共用的开发机：用 trust 建库等于把会话、
# 令牌哈希、私信与附件元数据对这台机器上的每个本地用户敞开。
# 口令只落在这一个 0600 文件里，部署脚本读它拼 DATABASE_URL。
PW_FILE="$KNOT_SITE_DIR/pg-knot-password"

mkdir -p "$(dirname "$PGD")" "$(dirname "$LOG")"
if [[ ! -f "$PGD/PG_VERSION" ]]; then
  # local 行仍是 trust：同机的 psql 走 socket，不必每次带口令；
  # host 行（127.0.0.1:端口）才需要口令，那也是别人唯一能连上的路径。
  # 已经用 trust 建过的库不会被改写：pg_hba.conf 只在 initdb 时生成，
  # 这里不擅自动旧实例，否则现有部署会突然连不上。
  "$BIN/initdb" -D "$PGD" -U knot --auth-local=trust --auth-host=scram-sha-256
  printf '%s\n' "$(openssl rand -hex 24)" >"$PW_FILE"
  chmod 600 "$PW_FILE"
fi

if [[ ! -f "$PW_FILE" ]]; then
  # 已存在的库（trust）没有口令文件也能连：留空，DATABASE_URL 照旧不带口令。
  PG_PW=""
else
  PG_PW="$(cat "$PW_FILE")"
fi
if ! "$BIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  "$BIN/pg_ctl" -D "$PGD" -l "$LOG" -o "-p $PORT -h 127.0.0.1" start
fi
# 建库时用本地 socket（local trust），不受 host 行口令影响。
if ! "$BIN/psql" -h "$PGD" -p "$PORT" -U knot -d postgres -qAt -c 'SELECT 1' >/dev/null 2>&1; then
  echo "连不上本机 Postgres（${PGD}，端口 ${PORT}）。看 ${LOG}。" >&2
  exit 1
fi
if [[ -n "$PG_PW" ]]; then
  # 每次启动都对一遍：口令文件被改过、库被重建过，都靠这一步同步。
  "$BIN/psql" -h "$PGD" -p "$PORT" -U knot -d postgres -q -v ON_ERROR_STOP=1 \
    -v pw="$PG_PW" -c "ALTER USER knot PASSWORD :'pw'" >/dev/null
fi

if ! CREATEDB_OUT="$("$BIN/createdb" -h 127.0.0.1 -p "$PORT" -U knot knot 2>&1)"; then
  # 只有「库已存在」可以忽略；其余失败（连不上、认证失败）直接报出来，
  # 一律吞掉会让部署以为库已经好了。
  case "$CREATEDB_OUT" in
    *"already exists"*) ;;
    *)
      echo "createdb 失败：${CREATEDB_OUT}" >&2
      exit 1
      ;;
  esac
fi
if [[ -n "$PG_PW" ]]; then
  PGPASSWORD="$PG_PW" "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U knot -d knot -qAt -c 'SELECT 1' >/dev/null ||
    { echo "口令认证失败：${PW_FILE} 与库里的口令不一致。" >&2; exit 1; }
fi
