#!/usr/bin/env bash
# 接入 XKnot 联邦：把中枢签发的接入件写进 sites/<站点>/xknot.env。
#
# 这一步和部署是分开的两件事：
#   * deploy-site.sh  ——  在这台机器上装代码、迁移、起服务。只读 site.env 与 platform.env。
#   * join-xknot.sh   ——  只写 xknot.env：实例 id、中枢地址、签发日期与委托发信凭据。
#
# 所以：没接入的站点照样能部署；重新部署不会动接入凭据；换机器只要把 xknot.env 带过去。
# 凭据只进这一个文件，权限 600，不进版本库、不进发布包、不进邮件。
#
# 用法：
#   ./ops/scripts/join-xknot.sh --site bot01 --payload ~/xknot-access.env
#   cat ~/xknot-access.env | ./ops/scripts/join-xknot.sh --site bot01 --payload -
#   ./ops/scripts/join-xknot.sh --site bot01 --status
#   ./ops/scripts/join-xknot.sh --site bot01 --remove
#
# 接入件就是一份 env 文件，格式由联邦契约规定（xknot.si/docs/FEDERATION.md 7.4），
# 键名不能改：
#
#   XKNOT_INSTANCE_ID=wang
#   XKNOT_HUB_ORIGIN=https://xknot.si
#   XKNOT_HUB_RELAY_TOKEN=xkr_wang_...
#   XKNOT_HUB_ISSUED_AT=2026-10-20
#
# 写入后要重启 Backend，服务才会读到新的环境。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_ARG=""
PAYLOAD=""
STATUS=0
REMOVE=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--site 后面要跟站点名" >&2; exit 2; }
      SITE_ARG="$2"
      shift 2
      ;;
    --payload | --in)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "$1 后面要跟接入件路径，或 - 表示从 stdin 读" >&2; exit 2; }
      PAYLOAD="$2"
      shift 2
      ;;
    --status)
      STATUS=1
      shift
      ;;
    --remove | --leave)
      REMOVE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h | --help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done

[[ -n "$SITE_ARG" ]] && export KNOT_SITE="$SITE_ARG"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

JOIN_ENV="$KNOT_XKNOT_ENV"

mask() {
  local value="${1:-}"
  if [[ -z "$value" ]]; then
    printf '（未配置）'
  elif (( ${#value} <= 12 )); then
    printf '****'
  else
    printf '%s…%s' "${value:0:8}" "${value: -4}"
  fi
}

print_status() {
  echo "站点      $KNOT_SITE  ($KNOT_SITE_DIR)"
  echo "接入文件  $JOIN_ENV"
  if [[ ! -f "$JOIN_ENV" ]]; then
    echo "状态      未接入 XKnot。部署与运行不受影响；要接入请用 --payload 写入接入件。"
    return 0
  fi
  local id origin relay token issued perms
  id="$(knot_env_get "$JOIN_ENV" XKNOT_INSTANCE_ID)"
  origin="$(knot_env_get "$JOIN_ENV" XKNOT_HUB_ORIGIN)"
  relay="$(knot_env_get "$JOIN_ENV" XKNOT_HUB_RELAY_URL)"
  token="$(knot_env_get "$JOIN_ENV" XKNOT_HUB_RELAY_TOKEN)"
  issued="$(knot_env_get "$JOIN_ENV" XKNOT_HUB_ISSUED_AT)"
  if [[ -z "$relay" && -n "$token" && -n "$origin" ]]; then
    relay="${origin%/}/api/federation/mail（按中枢地址推导）"
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    perms="$(stat -f '%Lp' "$JOIN_ENV" 2>/dev/null || echo '?')"
  else
    # GNU stat 的 -f 是「文件系统状态」而且照样返回 0，不能拿它兜底。
    perms="$(stat -c '%a' "$JOIN_ENV" 2>/dev/null || echo '?')"
  fi
  echo "状态      已接入"
  echo "实例 id   ${id:-（缺）}"
  echo "中枢      ${origin:-（缺）}"
  echo "委托发信  ${relay:-（用本机 SMTP）}"
  echo "凭据      $(mask "$token")"
  [[ -n "$issued" ]] && echo "签发日    $issued"
  echo "权限      $perms$([[ "$perms" == "600" ]] || echo '（应为 600）')"
  echo
  node "$KNOT_APP_DIR/ops/scripts/config.mjs" check --xknot --site "$KNOT_SITE" || true
}

if (( STATUS )); then
  print_status
  exit 0
fi

if (( REMOVE )); then
  if [[ ! -f "$JOIN_ENV" ]]; then
    echo "没有可移除的接入文件：$JOIN_ENV"
    exit 0
  fi
  if (( DRY_RUN )); then
    echo "(dry-run) 会删除 $JOIN_ENV"
    exit 0
  fi
  rm -f "$JOIN_ENV"
  echo "已移除 ${JOIN_ENV}。重启 Backend 后停止接入；门户上的实例条目要另找中枢下架。"
  exit 0
fi

if [[ -z "$PAYLOAD" ]]; then
  echo "缺少 --payload。用法见 ./ops/scripts/join-xknot.sh --help" >&2
  exit 2
fi

TMP_PAYLOAD=""
cleanup() {
  if [[ -n "$TMP_PAYLOAD" && -f "$TMP_PAYLOAD" ]]; then
    rm -f "$TMP_PAYLOAD"
  fi
  return 0
}
trap cleanup EXIT

if [[ "$PAYLOAD" == "-" ]]; then
  # 从 stdin 读时先落到权限 600 的临时文件：凭据不要经过可被别的进程读到的位置。
  TMP_PAYLOAD="$(mktemp "${TMPDIR:-/tmp}/xknot-access.XXXXXX")"
  chmod 600 "$TMP_PAYLOAD"
  cat >"$TMP_PAYLOAD"
  PAYLOAD="$TMP_PAYLOAD"
fi

[[ -f "$PAYLOAD" ]] || { echo "找不到接入件：$PAYLOAD" >&2; exit 1; }

if (( DRY_RUN )); then
  echo "(dry-run) 会用 $PAYLOAD 写入 $JOIN_ENV"
  node "$KNOT_APP_DIR/ops/scripts/config.mjs" join --site "$KNOT_SITE" --in "$PAYLOAD" --out "$JOIN_ENV.dryrun"
  rm -f "$JOIN_ENV.dryrun"
  exit 0
fi

node "$KNOT_APP_DIR/ops/scripts/config.mjs" join --site "$KNOT_SITE" --in "$PAYLOAD" --out "$JOIN_ENV"
chmod 600 "$JOIN_ENV"

echo
echo "接入已写入。重启 Backend 让它生效："
case "$(uname -s)" in
  Darwin)
    if launchctl print "gui/$(id -u)/com.knot.platform" >/dev/null 2>&1; then
      echo "  launchctl kickstart -k gui/$(id -u)/com.knot.platform"
    else
      # 没有常驻服务时不要为了改配置重跑整次部署。
      echo "  KNOT_SITE=$KNOT_SITE ./ops/scripts/run-knot-platform.sh"
    fi
    ;;
  *)
    echo "  sudo systemctl restart knot-backend"
    ;;
esac
echo "确认：./ops/scripts/join-xknot.sh --site $KNOT_SITE --status"
