#!/usr/bin/env bash
# macOS：用户目录 Postgres，不依赖 Colima / brew services。
# 端口、数据目录、日志位置、socket 目录和 PostgreSQL bin 目录来自 sites/<站点>/site.env。
#
# com.knot.<实例>.postgres 直接执行本脚本，所以这里自己读站点配置；
# 不能只靠 deploy-site.sh 传进来的进程环境。
#
# 幂等：库已初始化的重建、库已启动的再启动、口令每次都对齐、knot 库缺了就建。
# 所以 deploy-site.sh 每次都调它，不只「端口没响应时」调——上一次半途失败留下的
# 「库起来了但 knot 这个角色还没有口令」正是第二次部署最容易踩到的状态。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

PGD="$KNOT_PGDATA"
LOG="${KNOT_PGLOG:-$HOME/knot/pg.log}"
PORT="${KNOT_PGPORT:-5433}"
BIN="${KNOT_PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
# Unix socket 目录。libpq 的 -h 传一个路径时，那个路径是 **socket 目录**，不是数据
# 目录：这里以前写 -h "$PGD"，psql 便去找 $PGD/.s.PGSQL.<端口>，而服务端把 socket
# 建在编译默认的 /tmp，于是「库起来了、psql 却说连不上」，部署卡在切 current 之前。
# 现在起服务时用 -k 显式指定同一个目录，连服务时用 -h 指它，两边不再靠猜。
SOCK="${KNOT_PG_SOCKET_DIR:-/tmp}"
# 本机库的口令。实例主机常常是多人共用的开发机：用 trust 建库等于把会话、
# 令牌哈希、私信与附件元数据对这台机器上的每个本地用户敞开。
# 口令只落在这一个 0600 文件里，部署脚本读它拼 DATABASE_URL。
PW_FILE="$KNOT_SITE_DIR/pg-knot-password"

say() { echo "==> $*"; }

# 端口上坐着谁。pg_isready 只回答「这个端口是不是 Postgres」，被别的程序占着时
# 它只说 no response；再往下 pg_ctl 才报 could not bind，报错点离原因很远。
port_holder() {
  command -v lsof >/dev/null 2>&1 || return 0
  # pipefail 下 lsof 没匹配到也算失败，会让调用方的赋值在 set -e 里把脚本带走。
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" pid "$2}' || true
}

# 用本地 socket 连（local 行是 trust）：不受 host 行的口令影响，也不需要 env 里的口令。
socket_ok() {
  "$BIN/psql" -h "$1" -p "$PORT" -U knot -d postgres -qAt -c 'SELECT 1' >/dev/null 2>&1
}

# 实际能用的 socket 目录：先看配置的那个，再看服务端自己报的。
# 后者覆盖「库是旧脚本或手工起的，socket 建在别处」——这类实例不该因为一次升级
# 就必须停库重来。
resolve_socket_dir() {
  if socket_ok "$SOCK"; then printf '%s' "$SOCK"; return 0; fi
  local reported dir
  # 旧实例可能把 socket 建在别处。问服务端自己最准：走 host 行（127.0.0.1）。
  # 有口令就带口令，没有就按 trust 试——这一步失败只说明「问不到」，不是错误。
  reported="$(PGPASSWORD="$PG_PW" "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U knot -d postgres -qAt \
    -c 'SHOW unix_socket_directories' 2>/dev/null | head -n 1 || true)"
  # 服务端的值是逗号分隔的列表。
  for dir in ${reported//,/ }; do
    [[ -n "$dir" ]] || continue
    if socket_ok "$dir"; then printf '%s' "$dir"; return 0; fi
  done
  return 1
}

# 连不上时把「服务端到底把 socket 建在哪」也捞出来：postmaster 的启动参数里有 -k。
socket_from_postmaster() {
  local pid
  [[ -f "$PGD/postmaster.pid" ]] || return 0
  pid="$(head -n 1 "$PGD/postmaster.pid" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 0
  # ps 也可能失败（postmaster.pid 是上一次崩溃留下的）：pipefail 下这会让整个赋值
  # 非零，在 set -e 里把脚本带走——而这里本来只是在拼一句诊断。
  ps -o command= -p "$pid" 2>/dev/null |
    sed -n 's/.*[[:space:]]-k[[:space:]]\([^[:space:]]*\).*/\1/p' | head -n 1 || true
}

mkdir -p "$(dirname "$PGD")" "$(dirname "$LOG")" "$SOCK"
if [[ ! -f "$PGD/PG_VERSION" ]]; then
  # local 行仍是 trust：同机的 psql 走 socket，不必每次带口令；
  # host 行（127.0.0.1:端口）才需要口令，那也是别人唯一能连上的路径。
  # 已经用 trust 建过的库不会被改写：pg_hba.conf 只在 initdb 时生成，
  # 这里不擅自动旧实例，否则现有部署会突然连不上。
  say "initdb $PGD"
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
  HOLDER="$(port_holder)"
  if [[ -n "$HOLDER" ]]; then
    echo "端口 ${PORT} 已被 ${HOLDER} 占用，不是 Postgres，所以库起不来。" >&2
    echo "  换个端口：在 sites/${KNOT_SITE:-<站点>}/site.env 里把 KNOT_PGPORT 改成没人用的端口（不是 KNOT_PORT）。" >&2
    echo "  看占用者：lsof -nP -iTCP:${PORT} -sTCP:LISTEN" >&2
    exit 1
  fi
  say "start postgres :${PORT}（socket ${SOCK}）"
  "$BIN/pg_ctl" -D "$PGD" -l "$LOG" -o "-p $PORT -h 127.0.0.1 -k $SOCK" start
fi

if ! SOCK_USED="$(resolve_socket_dir)"; then
  echo "连不上本机 Postgres（数据目录 ${PGD}，端口 ${PORT}）。" >&2
  echo "  试过的 socket 目录：${SOCK}（KNOT_PG_SOCKET_DIR）" >&2
  LISTENING="$(port_holder)"
  if [[ -n "$LISTENING" ]]; then echo "  端口上在监听的是：${LISTENING}" >&2; fi
  for candidate in /tmp "$PGD" "$SOCK"; do
    if [[ -S "$candidate/.s.PGSQL.$PORT" ]]; then
      echo "  存在的 socket：${candidate}/.s.PGSQL.${PORT}" >&2
    fi
  done
  echo "  日志：${LOG}" >&2
  ACTUAL_SOCK="$(socket_from_postmaster)"
  if [[ -n "$ACTUAL_SOCK" ]]; then
    echo "  服务端用的 socket 目录是 ${ACTUAL_SOCK}：在 site.env 里把 KNOT_PG_SOCKET_DIR 改成它。" >&2
  else
    echo "  socket 建在别处时，在 site.env 里把 KNOT_PG_SOCKET_DIR 指过去。" >&2
  fi
  exit 1
fi

# 端口上坐着的必须是我们的库。下面就要对它改口令、建库，而同一个端口上可能是别人的
# 集群、brew 的默认实例，或者一个换了数据目录的旧实例：光「端口通」不足以说明是它。
#
# 比较前两边都归一化成物理路径：服务端报的是它启动时拿到的路径（/tmp/pgdata），这边
# cd + pwd -P 得到的是 /private/tmp/pgdata，直接比字符串会永远不等。
same_dir() {
  local a b
  a="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  b="$(cd "$2" 2>/dev/null && pwd -P)" || return 1
  [[ "$a" == "$b" ]]
}

ACTUAL_DIR="$(PGPASSWORD="$PG_PW" "$BIN/psql" -h "$SOCK_USED" -p "$PORT" -U knot -d postgres -qAt \
  -c 'SHOW data_directory' 2>/dev/null | head -n 1 || true)"
if [[ -n "$ACTUAL_DIR" ]] && ! same_dir "$ACTUAL_DIR" "$PGD"; then
  echo "端口 ${PORT} 上的库不是这个站点的：它的数据目录是 ${ACTUAL_DIR}，配置的是 ${PGD}。" >&2
  echo "  要么把 KNOT_PGPORT 换成没人用的端口，要么把 KNOT_PGDATA 指过去。这里不做任何改动。" >&2
  exit 1
fi

# 每次启动都对一遍口令：口令文件被改过、库被重建过、上一次在设口令前就退出过，都靠这一步同步。
#
# 走 stdin 而不是 -c：psql 只对从 stdin 或 -f 读进来的语句做变量替换，`-c "…:'pw'"`
# 会把 :'pw' 原样发给服务端，报 syntax error at or near ":"——新装的库因此从来没有
# 真正设上口令，第一次部署还看不出来，第二次也就走到 createdb 才报认证失败。
if [[ -n "$PG_PW" ]]; then
  "$BIN/psql" -h "$SOCK_USED" -p "$PORT" -U knot -d postgres -q -v ON_ERROR_STOP=1 \
    -v pw="$PG_PW" <<'SQL' >/dev/null
ALTER USER knot PASSWORD :'pw';
SQL
fi

# 建库走 host 行，和 Backend 用的是同一条路：socket 通而 host 不通（口令没对齐、
# pg_hba 只放行 local）时，现在就说清楚，而不是等迁移时再报。
if ! CREATEDB_OUT="$(PGPASSWORD="$PG_PW" "$BIN/createdb" -h 127.0.0.1 -p "$PORT" -U knot knot 2>&1)"; then
  # 只有「库已存在」可以忽略；其余失败（连不上、认证失败）直接报出来，
  # 一律吞掉会让部署以为库已经好了。
  case "$CREATEDB_OUT" in
    *"already exists"*) ;;
    *)
      echo "createdb 失败：${CREATEDB_OUT}" >&2
      if [[ -n "$PG_PW" ]] && printf '%s' "$CREATEDB_OUT" | grep -qi "password\|authentication"; then
        echo "  口令不一致：${PW_FILE} 与库里的 knot 口令不同。删掉这个文件后重跑会重设口令（本机库，无外部使用者时可行）。" >&2
      fi
      exit 1
      ;;
  esac
fi

PGPASSWORD="$PG_PW" "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U knot -d knot -qAt -c 'SELECT 1' >/dev/null ||
  { echo "连不上 knot 库（127.0.0.1:${PORT}）：口令或 pg_hba 不对，口令文件 ${PW_FILE}。" >&2; exit 1; }
