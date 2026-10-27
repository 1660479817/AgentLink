#!/usr/bin/env bash
# 把一台新 macOS 补到「Knot 能装」的状态：Node 22+ 与 PostgreSQL 16 的二进制。
#
# 默认只打印计划，加 --yes 才动手。它只做两件事：
#   1. 没有 22+ 的 node 时装 node@22（brew keg-only，不会顶掉机器上已有的 node）；
#   2. KNOT_PG_BIN 下没有 initdb 时装 postgresql@16（同样 keg-only）。
#
# 它明确不做的事，都是有代价才划出来的：
#   * 不 brew services start，不 initdb，不建库、不设端口、不碰数据目录——那些归
#     deploy-site.sh / ensure-knot-postgres.sh，出问题回滚的是那两步，不是系统包；
#   * 不改 site.env、不写 platform.env、不装 LaunchAgent；
#   * 不代装 Homebrew 本身（缺了只给官网地址）；
#   * 不读 stdin：经 ssh 部署时它由目标机上的 deploy-site.sh 就地调用
#     （./ops/scripts/push-deploy.sh --bootstrap 会带这个开关），不靠管道喂脚本。
#
# 用法（在实例主机的发布包或源码目录里）：
#   ./ops/scripts/bootstrap-host.sh --site bot00 --plan
#   ./ops/scripts/bootstrap-host.sh --site bot00 --yes
#   ./ops/scripts/bootstrap-host.sh --deploy-root ~/knot/bot00 --site bot00 --yes
#   ./ops/scripts/deploy-site.sh --site bot00 --bootstrap     # 门禁失败时自动调用
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="${KNOT_SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
# 通过 `ssh … bash -s < script` 喂脚本时 $0 是 "bash"，lib 与站点模板都找不到。
# 与其在 /opt/homebrew 的报错里绕圈，不如直接说清该走哪条路。
if [[ ! -f "$SCRIPT_DIR/lib/host-check.sh" ]]; then
  echo "错误：找不到 ${SCRIPT_DIR}/lib/host-check.sh。" >&2
  echo "本脚本要在发布包或源码目录里执行；经 ssh 部署请用 ./ops/scripts/push-deploy.sh --site <站点> --bootstrap。" >&2
  exit 2
fi
SITE_ARG=""
DEPLOY_ROOT_ARG=""
DO_IT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--site 后面要跟站点名" >&2; exit 2; }
      SITE_ARG="$2"
      shift 2
      ;;
    --deploy-root)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--deploy-root 后面要跟部署根目录" >&2; exit 2; }
      DEPLOY_ROOT_ARG="$2"
      shift 2
      ;;
    --yes)
      DO_IT=1
      shift
      ;;
    --plan)
      DO_IT=0
      shift
      ;;
    -h | --help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done

[[ -n "$SITE_ARG" ]] && export KNOT_SITE="$SITE_ARG"
[[ -n "$DEPLOY_ROOT_ARG" ]] && export KNOT_DEPLOY_ROOT="$DEPLOY_ROOT_ARG"

# 部署根：显式给的优先，否则按「脚本在 releases/<版本>/ops/scripts 下」还是
# 「脚本在源码目录里」各推一次。站点配置可能还不存在，那也算正常。
if [[ -z "${KNOT_DEPLOY_ROOT:-}" ]]; then
  APP_UP="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
  if [[ "$(basename "$(dirname "$APP_UP")")" == "releases" ]]; then
    KNOT_DEPLOY_ROOT="$(dirname "$(dirname "$APP_UP")")"
  else
    KNOT_DEPLOY_ROOT="$APP_UP"
  fi
  export KNOT_DEPLOY_ROOT
fi
SITE_NAME="${KNOT_SITE:-}"
SITE_ENV=""
if [[ -n "$SITE_NAME" ]]; then
  SITE_ENV="$KNOT_DEPLOY_ROOT/sites/$SITE_NAME/site.env"
fi

# 只取这两项，不把整份 site.env source 进当前 shell：bootstrap 不该被别人的
# 取值（端口、入口、隧道）牵着走，也不该反过来改它们。
SITE_PG_BIN=""
SITE_DB_MODE=""
if [[ -n "$SITE_ENV" && -f "$SITE_ENV" ]]; then
  SITE_PG_BIN="$(sed -n 's/^[[:space:]]*KNOT_PG_BIN=//p' "$SITE_ENV" | tail -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s|^~|$HOME|")"
  SITE_DB_MODE="$(sed -n 's/^[[:space:]]*KNOT_DB_MODE=//p' "$SITE_ENV" | tail -n 1 | sed -e 's/^"//' -e 's/"$//')"
fi
export KNOT_PG_BIN="${SITE_PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
export KNOT_DB_MODE="${SITE_DB_MODE:-local}"
export KNOT_PGPORT="${KNOT_PGPORT:-5433}"

# shellcheck source=lib/host-check.sh
source "$SCRIPT_DIR/lib/host-check.sh"

BREW="$(knot_brew_bin)"

say() { echo "==> $*"; }
plan() { echo "    将执行：$*"; }

# 只检查，不打印：bootstrap 自己决定怎么说，失败信息由 host-check 里的 fix 行给出。
knot_pf_begin
knot_check_host_platform || { knot_pf_finish "主机"; exit 1; }

need_node=1
NODE_BIN=""
NODE_VER=""
knot_pf_begin
if knot_check_node >/dev/null 2>&1; then
  need_node=0
  NODE_BIN="$KNOT_NODE_BIN"
  NODE_VER="$(knot_node_version "$NODE_BIN")"
fi

# external 接的是已有库：bootstrap 一个包都不该装（「Linux 必须 external」那条
# 规则在 main 里已经没有了；macOS 上用 external 仍然合法）。
need_pg=0
if [[ "$KNOT_DB_MODE" != "external" && ! -x "$KNOT_PG_BIN/initdb" ]]; then
  need_pg=1
fi

echo "站点 ${SITE_NAME:-（未指定）} @ ${KNOT_DEPLOY_ROOT}"
echo "数据库模式 ${KNOT_DB_MODE}；Homebrew ${BREW}"

if (( need_node == 0 && need_pg == 0 )); then
  echo
  echo "Node 与 PostgreSQL 都已就绪，不需要装任何东西。"
  echo "  Node       v${NODE_VER} ${NODE_BIN}"
  echo "  Postgres   ${KNOT_PG_BIN}"
  exit 0
fi

if [[ ! -x "$BREW" ]]; then
  cat >&2 <<EOF
错误：找不到 Homebrew（${BREW}）。脚本不代装 Homebrew，先按官方说明装好：
  https://brew.sh
装完重跑：./ops/scripts/bootstrap-host.sh --site ${SITE_NAME:-<站点>} --yes
EOF
  exit 1
fi

if (( DO_IT == 0 )); then
  echo
  echo "计划（还没动手）："
  (( need_node == 1 )) && plan "${BREW} install node@22"
  (( need_pg == 1 )) && plan "${BREW} install postgresql@16"
  echo
  echo "不改的东西：brew 的常驻服务、数据目录、端口、site.env、LaunchAgent 都不碰；"
  echo "建库与起库仍由 deploy-site.sh 负责（回滚也只回滚那一步）。"
  echo
  echo "确认后执行：./ops/scripts/bootstrap-host.sh --site ${SITE_NAME:-<站点>} --yes"
  exit 0
fi

if (( need_node == 1 )); then
  say "install node@22"
  "$BREW" install node@22
fi
if (( need_pg == 1 )); then
  say "install postgresql@16"
  "$BREW" install postgresql@16
fi

# 装完立刻按同一套规则复检：brew 也可能「退出码 0 但版本不对」，不以退出码为准。
echo
echo "==> 复检"
knot_pf_begin
knot_check_node || true
if [[ "$KNOT_DB_MODE" != "external" ]]; then
  knot_check_pg_local || true
fi
if ! knot_pf_finish "主机"; then
  echo >&2
  echo "装完仍不达标：以上面的实际路径与版本为准，必要时把 KNOT_PG_BIN / KNOT_NODE_BIN 指过去。" >&2
  exit 1
fi
echo
echo "下一步：./ops/scripts/push-deploy.sh --site ${SITE_NAME:-<站点>}"
