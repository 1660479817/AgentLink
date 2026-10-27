#!/usr/bin/env bash
# 卸载这台站点上的「执行器」，数据一律不动。
#
# 用法：
#   ./ops/scripts/uninstall-site.sh --site bot01 --dry-run   # 只列计划，不改任何东西
#   ./ops/scripts/uninstall-site.sh --site bot01 --yes       # 真卸载
#
# 「执行器」是这台机器上会自己起来的东西：六个 LaunchAgent（platform、postgres、
# backup、gc、entry-tunnel、openclaw-probe），以及 --runtime none 时后台起的那个
# 进程（pid 记在 var/run/backend.pid）。卸载 = 停掉它们、删掉它们的 plist，
# 于是站点不再自己启动、不再对外连隧道。
#
# 数据一律不动，这一条没有开关：
#   * 数据库进程不停。停库要落检查点、要碰数据目录，而「不动」比「干净地停」更重要；
#     真要停它，用最后打印的那条 pg_ctl 命令人工做，那时候你清楚自己在做什么。
#   * 数据目录、上传目录、站点配置、发布包、日志、隧道私钥、接入件，全部保留。
#   * 脚本里没有 rm -rf，也没有对部署根下任何路径的删除。删的只有
#     $HOME/Library/LaunchAgents/<标签>.plist，而且每个路径都先过一道校验。
#
# 卸载前后各数一遍数据区（文件数与字节数），对不上就报错并以非零退出：
# 这是一个只读的自证，用来证明「没动过」，不是用来兜底的。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_ARG=""
DEPLOY_ROOT_ARG=""
DRY_RUN=0
ASSUME_YES=0

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
}

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
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done

# `[[ ]] && cmd` 在 `set -e` 下不成立就直接退出：这里必须写成 if。
if [[ -n "$SITE_ARG" ]]; then export KNOT_SITE="$SITE_ARG"; fi
if [[ -n "$DEPLOY_ROOT_ARG" ]]; then export KNOT_DEPLOY_ROOT="$DEPLOY_ROOT_ARG"; fi

SITE_LIB="$SCRIPT_DIR/lib/site-config.sh"
if [[ ! -f "$SITE_LIB" && -n "${KNOT_DEPLOY_ROOT:-}" ]]; then
  SITE_LIB="$KNOT_DEPLOY_ROOT/current/ops/scripts/lib/site-config.sh"
fi
if [[ ! -f "$SITE_LIB" ]]; then
  echo "找不到 lib/site-config.sh；请在发布包或仓库的 ops/scripts/ 下运行。" >&2
  exit 2
fi
# shellcheck source=lib/site-config.sh
source "$SITE_LIB"

# 平台文件存在时读它：KNOT_PGDATA、UPLOAD_DIR 这些运行值可能只在那边有。
knot_source_platform_env

UID_NUM="$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
# HOME 空或不是绝对路径时，$HOME/Library/LaunchAgents 会变成 /Library/LaunchAgents，
# 那是系统级目录，里面装的是别人的单位。宁可什么都不做，也不往那里删。
case "${HOME:-}" in
  /*) ;;
  *)
    echo "HOME 不是绝对路径（${HOME:-<空>}），不知道去哪个 LaunchAgents 卸载；停止，未改动任何东西。" >&2
    exit 2
    ;;
esac
INSTANCE="$(knot_instance)"
ROLES="platform postgres backup gc entry-tunnel openclaw-probe"

# ---- 数据区：只读，只用来证明「没动过」----
# 日志与 pid 会随着进程退出而变，不算数据；pgdata 里进程退出时也可能只动 WAL 的
# mtime 而不改字节，所以比的是「文件数 + 总字节数」而不是 mtime。
DATA_ZONES=(
  "$(knot_expand_path "${KNOT_PGDATA:-$HOME/knot/pgdata}")"
  "$(knot_expand_path "${KNOT_UPLOAD_DIR:-${UPLOAD_DIR:-$KNOT_DEPLOY_ROOT/var/uploads}}")"
  "$KNOT_DEPLOY_ROOT/sites"
  "$KNOT_DEPLOY_ROOT/releases"
  "$KNOT_DEPLOY_ROOT/artifacts"
)

data_fingerprint() {
  local dir counts files=0 bytes=0 n size
  for dir in "${DATA_ZONES[@]}"; do
    [[ -d "$dir" ]] || continue
    counts="$(find "$dir" -type f -exec stat -f '%z' {} + 2>/dev/null | awk '{n++; s+=$1} END {print n+0, s+0}')" || counts="0 0"
    n="${counts%% *}"
    size="${counts##* }"
    files=$((files + n))
    bytes=$((bytes + size))
  done
  printf '%s %s' "$files" "$bytes"
}

# ---- 校验一个待删路径确实是一个 LaunchAgent 的 plist ----
# 不是这个形状就拒绝，而不是「差不多就删」。
knot_uninstall_verify_path() {
  local path="$1" base
  base="$(basename "$path")"
  case "$(dirname "$path")" in
    "$AGENTS_DIR") ;;
    *)
      echo "拒绝删除：${path} 不在 ${AGENTS_DIR} 下。" >&2
      return 1
      ;;
  esac
  case "$base" in
    com.knot.*.plist) ;;
    *)
      echo "拒绝删除：${base} 不是 com.knot.*.plist。" >&2
      return 1
      ;;
  esac
  return 0
}

plist_references_root() {
  local plist="$1" text
  text="$(plutil -convert xml1 -o - "$plist" 2>/dev/null || cat "$plist" 2>/dev/null || true)"
  case "$text" in
    *"$KNOT_DEPLOY_ROOT/current/"*) return 0 ;;
  esac
  return 1
}

plist_field() {
  local plist="$1" key="$2"
  plutil -convert xml1 -o - "$plist" 2>/dev/null \
    | awk -v key="$key" '
        $0 ~ "<key>" key "</key>" { getline; gsub(/.*<string>|<\/string>.*/, ""); print; exit }
      ' || true
}

is_own_label() {
  local label="$1" role
  for role in $ROLES; do
    [[ "$label" == "$(knot_label "$role")" ]] && return 0
  done
  return 1
}

# 进程真的没了才算没了。`kill -0` 对已经退出但还没被父进程回收的僵尸也返回成功，
# 只等它会让脚本白等十秒，最后还报「停不掉」。
pid_is_gone() {
  local pid="$1" stat
  kill -0 "$pid" 2>/dev/null || return 0
  stat="$(ps -o stat= -p "$pid" 2>/dev/null || true)"
  [[ -z "$stat" ]] && return 0
  case "$stat" in Z*) return 0 ;; esac
  return 1
}

knot_wait_pid_gone() {
  local pid="$1" waited=0
  while ! pid_is_gone "$pid" && (( waited < 100 )); do
    sleep 0.1
    waited=$((waited + 1))
  done
  pid_is_gone "$pid"
}

# ---- 找本次要卸载的单元 ----
# 两种归属都要认：
#   1. 本实例的六个标签（com.knot.<实例>.<角色>）——当前部署装的；
#   2. 任何引用本部署根 current 的 com.knot.*.plist——改名前的旧标签、手工装的残留。
# 第二种是同一套归属规则：引用了本部署根，就归本部署根管。
UNITS=()
CONFLICTS=()
for role in $ROLES; do
  label="$(knot_label "$role")"
  plist="$AGENTS_DIR/$label.plist"
  [[ -f "$plist" ]] || continue
  if ! plist_references_root "$plist"; then
    # 标签是我们的，内容却不是我们的：说明这个标签被别的部署根占着。
    # 删掉它等于替别人卸载，所以只报出来，不动。
    CONFLICTS+=("${label}（内容指向 $(plist_field "$plist" KNOT_DEPLOY_ROOT)，不是 ${KNOT_DEPLOY_ROOT}）")
    continue
  fi
  UNITS+=("$plist")
done

for plist in "$AGENTS_DIR"/com.knot.*.plist; do
  [[ -f "$plist" ]] || continue
  label="$(basename "$plist" .plist)"
  already=0
  for unit in ${UNITS[@]+"${UNITS[@]}"}; do
    [[ "$unit" == "$plist" ]] && already=1
  done
  if (( already == 1 )); then continue; fi
  # 本实例六个标签之外、但引用本部署根的旧标签（例如改名前的 com.knot.platform）。
  if is_own_label "$label"; then continue; fi
  plist_references_root "$plist" || continue
  UNITS+=("$plist")
done

MANUAL_PID_FILE="$KNOT_DEPLOY_ROOT/var/run/backend.pid"
MANUAL_PID=""
if [[ -f "$MANUAL_PID_FILE" ]]; then
  MANUAL_PID="$(cat "$MANUAL_PID_FILE" 2>/dev/null || true)"
fi

# ---- 报告 ----
echo "站点    ${KNOT_SITE}（实例 ${INSTANCE}）"
echo "部署根  ${KNOT_DEPLOY_ROOT}"
echo
if [[ ${#UNITS[@]} -eq 0 ]]; then
  echo "没有找到归本部署根管的常驻单元。"
else
  echo "将停掉并移除这些单元："
  for unit in "${UNITS[@]}"; do
    echo "  $(basename "$unit" .plist)"
  done
fi
if [[ -n "$MANUAL_PID" ]]; then
  echo "将停掉 --runtime none 起的后台进程：pid ${MANUAL_PID}"
fi
if [[ ${#CONFLICTS[@]} -gt 0 ]]; then
  echo
  echo "警告：这些标签属于本实例，但内容指向别处，不会动它们："
  for line in "${CONFLICTS[@]}"; do
    echo "  $line"
  done
fi

echo
echo "一律保留（不动、不删、不连）："
for dir in "${DATA_ZONES[@]}"; do
  if [[ -d "$dir" ]]; then
    echo "  ${dir}"
  fi
done

if (( DRY_RUN == 1 )); then
  echo
  echo "dry-run：没有改动任何东西。"
  exit 0
fi

if (( ASSUME_YES != 1 )); then
  echo
  echo "这会停掉站点并移除它的常驻单元，数据不动。确认执行：" >&2
  echo "  ./ops/scripts/uninstall-site.sh --site ${KNOT_SITE} --yes" >&2
  exit 1
fi

BEFORE="$(data_fingerprint)"

for unit in ${UNITS[@]+"${UNITS[@]}"}; do
  label="$(basename "$unit" .plist)"
  knot_uninstall_verify_path "$unit" || { echo "中止：路径校验没通过。" >&2; exit 1; }
  pid="$(launchctl print "gui/$UID_NUM/$label" 2>/dev/null | awk '/pid = /{print $3; exit}' || true)"
  echo "==> 停 ${label}"
  knot_bootout_launchd "$label"
  # bootout 是异步的：等它真的退出，否则「卸载完」可能只是「打着标记还在跑」。
  if [[ -n "$pid" ]]; then
    knot_wait_pid_gone "$pid" || true
  fi
  echo "==> 移除 $(basename "$unit")"
  rm -f "$unit"
done

if [[ -n "$MANUAL_PID" ]] && ! pid_is_gone "$MANUAL_PID"; then
  echo "==> 停后台进程 ${MANUAL_PID}"
  kill "$MANUAL_PID" 2>/dev/null || true
  if ! knot_wait_pid_gone "$MANUAL_PID"; then
    echo "警告：进程 ${MANUAL_PID} 没有在十秒内退出，它可能还在监听端口。" >&2
  fi
fi
# pid 文件不是数据，但它是「有个进程在跑」的记录；进程已经没了，留着会误导回滚脚本。
rm -f "$MANUAL_PID_FILE"

AFTER="$(data_fingerprint)"
if [[ "$BEFORE" != "$AFTER" ]]; then
  echo >&2
  echo "错误：数据区在卸载前后对不上（卸载前 ${BEFORE}，卸载后 ${AFTER}，单位：文件数 字节数）。" >&2
  echo "这个脚本不该改动任何数据。请立刻停下并检查，不要重跑部署去掩盖它。" >&2
  exit 1
fi

echo
echo "卸载完成。站点不再自己启动，也不会再连隧道。"
echo "数据未动：${AFTER%% *} 个文件、${AFTER##* } 字节，与卸载前一致。"
if [[ -d "$(knot_expand_path "${KNOT_PGDATA:-$HOME/knot/pgdata}")" ]]; then
  echo
  echo "数据库进程没有停（停库要碰数据目录，卸载不做这件事）。要停它，人工执行："
  echo "  ${KNOT_PG_BIN}/pg_ctl -D $(knot_expand_path "${KNOT_PGDATA:-$HOME/knot/pgdata}") -m fast stop"
fi
echo
echo "重新上线：./ops/scripts/deploy-site.sh --site ${KNOT_SITE} --artifact <发布包>"
