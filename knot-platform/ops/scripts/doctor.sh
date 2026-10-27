#!/usr/bin/env bash
# 在实例主机上一条命令查完「这台站点现在是不是好的」。
#
# 用法：
#   ./ops/scripts/doctor.sh --site bot01
#   ./ops/scripts/doctor.sh --site local --no-public
#
# 先查主机（平台、Node），再查站点，任何一项不过就以非零退出：
#   平台      必须是 macOS（实例主机只支持 macOS + launchd）
#   Node      22+，并且记进 platform.env 的绝对路径可用
#   隧道私钥   KNOT_TUNNEL=1 时，按站点目录解析出的私钥在不在、读不读得到
#   本机后端   http://127.0.0.1:<KNOT_PORT>/api/health
#   数据库     /api/web/information（真读一次库，不只看进程在不在）
#   常驻单元   com.knot.platform，接了隧道再加 com.knot.entry-tunnel
#   公网入口   <KNOT_PUBLIC_ORIGIN>/api/health，也就是「别人能不能打开」
#
# 入口 502 那类故障，坏在隧道私钥或常驻单元上：入口 nginx 把请求交给回环端口，
# 隧道没起来就没人监听，而实例自己的 Backend 一切正常。只看本机 /api/health
# 会以为站点是好的，所以这里必须把公网那一跳也查了。
#
# 公网那一跳默认不走系统代理：开发机上的代理挂了会把「站点坏了」误报成真的。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_ARG=""
DEPLOY_ROOT_ARG=""
CHECK_PUBLIC=1

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
    --no-public)
      CHECK_PUBLIC=0
      shift
      ;;
    -h | --help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
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

# 站点配置的读取与部署脚本共用一份。脚本被单独拷到别处跑时（例如从开发机
# 把这个文件送到实例主机的 /tmp 做体检），按部署根找一次库文件。
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

# 托管段与 run-entry-tunnel.sh 同源：接了 xknot.si 子域的站点，隧道这一组键
# 在 tunnel.env 里（site.env 的 KNOT_TUNNEL 仍是 0）。只读 site.env 会把
# 「站点正靠隧道对外服务」看成「没开隧道」，正好漏掉最该查的那一项。
if [[ -f "${KNOT_SITE_DIR:-}/tunnel.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$KNOT_SITE_DIR/tunnel.env"
  set +a
fi

# 隧道这一组键是 /admin 写的托管段，还是站点主人在 site.env 里手写的？
# 只有托管段才要求「只写文件名」：手写配置用 $HOME/.ssh/... 是正常写法，
# 那把钥匙本来就该待在仓库和站点目录之外。
TUNNEL_MANAGED=0
if [[ -f "${KNOT_SITE_DIR:-}/tunnel.env" ]] && grep -q 'XKnot 自动接通' "$KNOT_SITE_DIR/tunnel.env" 2>/dev/null; then
  TUNNEL_MANAGED=1
fi

FAILED=0
WARNED=0

row() {
  # row <ok|warn|fail> <名称> <说明>
  local mark="$1" name="$2" detail="$3"
  case "$mark" in
    ok) printf '  ok    %-12s %s\n' "$name" "$detail" ;;
    warn)
      WARNED=1
      printf '  warn  %-12s %s\n' "$name" "$detail"
      ;;
    *) printf '  FAIL  %-12s %s\n' "$name" "$detail" ;;
  esac
}

fail() {
  FAILED=1
  row fail "$1" "$2"
}

curl_health() {
  curl -fsS --noproxy '*' --max-time 8 "$1" 2>/dev/null
}

echo "站点 ${KNOT_SITE} @ ${KNOT_DEPLOY_ROOT}"
if [[ "$KNOT_DEPLOY_ROOT" == "$KNOT_APP_DIR" ]]; then
  row warn "部署根" "读的是源码目录，不是已安装的实例；查实例请加 --deploy-root <部署根>"
fi

# ---- 0. 主机 ----
# 和 deploy-site.sh 用同一份判定：这台机器是不是还能跑 Knot。
# 常见情形是换了 node 版本或删了 brew 包，服务起不来只报「node: command not found」。
# shellcheck source=lib/host-check.sh
source "$SCRIPT_DIR/lib/host-check.sh"
knot_pf_begin
knot_check_host_platform || true
knot_check_node || true
knot_pf_finish "主机" || FAILED=1

# ---- 1. 隧道私钥 ----
# 解析函数在 lib/site-config.sh 里；0.6.0 之前的发布包没有它，这里补一份同样的
# 解析，让 doctor 在旧实例上也能用。升级之后走库里的那一份，不再用这里的备份逻辑。
if ! command -v knot_tunnel_key_path >/dev/null 2>&1; then
  knot_tunnel_key_path() {
    local value
    value="$(knot_expand_path "${KNOT_TUNNEL_KEY:-}")"
    case "$value" in
      "") printf '%s/%s' "$KNOT_SITE_DIR" "tunnel_ed25519" ;;
      /*) printf '%s' "$value" ;;
      *) printf '%s/%s' "$KNOT_SITE_DIR" "$value" ;;
    esac
  }
  row warn "站点脚本" "这台实例的发布包早于 knot_tunnel_key_path，升级前按旧规则解析私钥"
fi

if knot_enabled KNOT_TUNNEL; then
  TUNNEL_KEY_FILE="$(knot_tunnel_key_path)"
  if [[ ! -f "$TUNNEL_KEY_FILE" ]]; then
    fail "隧道私钥" "不存在：${TUNNEL_KEY_FILE}（KNOT_TUNNEL_KEY=${KNOT_TUNNEL_KEY:-空}）"
  elif [[ ! -r "$TUNNEL_KEY_FILE" ]]; then
    fail "隧道私钥" "读不到：${TUNNEL_KEY_FILE}，检查属主与权限"
  else
    row ok "隧道私钥" "${TUNNEL_KEY_FILE}"
    # 旧版 /admin 写的是绝对路径。路径碰巧还对也能用，但站点目录一搬就断，
    # 所以只提示、不算失败：改回相对写法要重新接通一次。
    if [[ "$TUNNEL_MANAGED" == 1 ]]; then
      case "${KNOT_TUNNEL_KEY:-}" in
        /*)
          case "$KNOT_TUNNEL_KEY" in
            "$KNOT_SITE_DIR"/*) ;;
            *) row warn "隧道私钥" "托管段写的是绝对路径（${KNOT_TUNNEL_KEY}），站点目录搬家会失效；升级后重新接通即改为文件名" ;;
          esac
          ;;
      esac
    fi
  fi
else
  row ok "隧道私钥" "未开隧道（KNOT_TUNNEL=0）"
fi

# ---- 2. 本机后端 ----
LOCAL_HEALTH="$(curl_health "http://127.0.0.1:${KNOT_PORT}/api/health")"
if [[ -z "$LOCAL_HEALTH" ]]; then
  fail "本机后端" "http://127.0.0.1:${KNOT_PORT}/api/health 没有响应"
else
  VERSION="$(printf '%s' "$LOCAL_HEALTH" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  COMMIT="$(printf '%s' "$LOCAL_HEALTH" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')"
  row ok "本机后端" "${VERSION:-?} ${COMMIT:-}"
fi

# ---- 3. 数据库 ----
if [[ -n "$LOCAL_HEALTH" ]]; then
  if curl_health "http://127.0.0.1:${KNOT_PORT}/api/web/information" >/dev/null; then
    row ok "数据库" "/api/web/information 可读"
  else
    fail "数据库" "/api/web/information 失败：库没起或连接不上"
  fi
else
  row warn "数据库" "后端没起来，跳过"
fi

# ---- 4. 常驻单元 ----
unit_state() {
  # unit_state <LaunchAgent 标签>；打印 running / loaded / missing
  local name="$1"
  local out
  out="$(launchctl print "gui/$(id -u)/${name}" 2>/dev/null)" || { echo missing; return; }
  printf '%s' "$out" | awk '/state = /{print $3; exit; }'
}

UNITS="com.knot.platform"
if knot_enabled KNOT_TUNNEL; then
  UNITS="${UNITS} com.knot.entry-tunnel"
fi

UNIT_MSG=""
UNIT_BAD=""
for unit in $UNITS; do
  state="$(unit_state "$unit")"
  UNIT_MSG="${UNIT_MSG}${UNIT_MSG:+ }${unit}=${state}"
  [[ "$state" == "running" || "$state" == "active" ]] || UNIT_BAD="${UNIT_BAD}${UNIT_BAD:+、}${unit}"
done
if [[ -n "$UNIT_BAD" ]]; then
  fail "常驻单元" "${UNIT_MSG}（未运行：${UNIT_BAD}）"
else
  row ok "常驻单元" "$UNIT_MSG"
fi

# ---- 5. 公网入口 ----
ORIGIN_HOST="$(knot_origin_host "$KNOT_PUBLIC_ORIGIN")"
if [[ "$CHECK_PUBLIC" == 0 ]]; then
  row warn "公网入口" "已跳过（--no-public）"
elif [[ -z "$ORIGIN_HOST" || "$ORIGIN_HOST" == "127.0.0.1" || "$ORIGIN_HOST" == "localhost" ]]; then
  row warn "公网入口" "KNOT_PUBLIC_ORIGIN 是本机地址（${KNOT_PUBLIC_ORIGIN}），没有公网入口可查"
else
  PUBLIC_HEALTH="$(curl_health "${KNOT_PUBLIC_ORIGIN}/api/health")"
  if [[ -z "$PUBLIC_HEALTH" ]]; then
    fail "公网入口" "${KNOT_PUBLIC_ORIGIN}/api/health 打不通：先看隧道的常驻单元与私钥，再看入口 nginx"
  else
    PUBLIC_INSTANCE="$(printf '%s' "$PUBLIC_HEALTH" | sed -n 's/.*"instance":"\([^"]*\)".*/\1/p')"
    row ok "公网入口" "${KNOT_PUBLIC_ORIGIN}/api/health ${PUBLIC_INSTANCE:+instance=${PUBLIC_INSTANCE}}"
  fi
fi

echo
if [[ "$FAILED" == 0 && "$WARNED" == 0 ]]; then
  echo "全部通过。"
elif [[ "$FAILED" == 0 ]]; then
  echo "通过，但有警告。"
else
  echo "有检查项没过，先修再发布。"
fi
exit "$FAILED"
