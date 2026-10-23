#!/usr/bin/env bash
# 把发现页公开快照推到 xknot.si 子域入口的 WebUI 目录。
#
# 平台在内容变化后调用它。入口主机来自 sites/<站点>/site.env（KNOT_ENTRY_ENABLED=1、KNOT_ENTRY_SSH）；
# 落到哪个目录来自 sites/<站点>/entry.<域名>.env 的 KNOT_ENTRY_WEB_ROOT。
#
# nginx 的 /discover.json 是 try_files 先看磁盘再看隧道，所以入口磁盘上留一份旧文件
# 就会一直命中旧的、不回落。快照只有几十 KB，推一份过去比让读者穿隧道取更划算。
#
# proxy 投放不需要推：它的 / 与 /discover.json 本来就整段回源。
#
# 用法：push-discover.sh /path/to/board
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

BOARD="${1:?board directory}"

# 同一台实例上两次内容变更挨得很近时，Backend 会几乎同时起两个推送。
# 两个进程写同一份 discover.json 的中转与安装交错，装上去的可能是旧快照。
# shellcheck source=lib/lock.sh
source "$SCRIPT_DIR/lib/lock.sh"
PUSH_LOCK="${TMPDIR:-/tmp}/knot-push-discover.${KNOT_SITE}.lock"
knot_lock "$PUSH_LOCK" "快照推送" || exit 1
trap knot_unlock EXIT

if ! knot_enabled KNOT_ENTRY_ENABLED; then
  echo "KNOT_ENTRY_ENABLED 未开启（local 部署），快照只留在 $BOARD"
  exit 0
fi
knot_require KNOT_ENTRY_SSH "在 sites/$KNOT_SITE/site.env 里配置 KNOT_ENTRY_SSH=user@entry-host。"
knot_require KNOT_DOMAIN "在 sites/$KNOT_SITE/site.env 里配置 KNOT_DOMAIN=<标签>.xknot.si。"

if [[ ! -f "$BOARD/discover.json" ]]; then
  echo "missing $BOARD/discover.json" >&2
  exit 1
fi

SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
# 实例主机用 KNOT_ENTRY_PUSH_KEY；旧机器把它写在运行时文件的 KNOT_ENTRY_SSH_KEY 里。
# KNOT_ENTRY_PUSH_KEY 有默认路径，所以默认路径不存在时再退回旧键。
ENTRY_KEY="$(knot_expand_path "${KNOT_ENTRY_PUSH_KEY:-}")"
if [[ ! -f "$ENTRY_KEY" && -n "${KNOT_ENTRY_SSH_KEY:-}" ]]; then
  ENTRY_KEY="$(knot_expand_path "$KNOT_ENTRY_SSH_KEY")"
fi
if [[ -n "$ENTRY_KEY" ]]; then
  SSH_OPTS+=(-i "$ENTRY_KEY")
fi

ENTRY_FILE="$KNOT_SITE_DIR/entry.$KNOT_DOMAIN.env"
[[ -f "$ENTRY_FILE" ]] || {
  echo "missing $ENTRY_FILE" >&2
  exit 1
}
SERVE="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_SERVE)"
if [[ "${SERVE:-static}" != "static" ]]; then
  echo "入口是 proxy 投放，快照整段回源，不需要推送"
  exit 0
fi
WEB_ROOT="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_WEB_ROOT)"
# 入口文件没写这一项时，knot_entry_value 会回落到共用的 /var/www/knot：
# 同一台入口主机上所有子域共用的一份静态根。这条推送是 sudo 落进系统目录，
# 落错地方就是把别的子域的快照覆盖掉。留空不是「用默认」，是配错。
case "$WEB_ROOT" in
  "" | /var/www/knot)
    echo "入口 ${KNOT_DOMAIN} 的 KNOT_ENTRY_WEB_ROOT 是空的或共用缺省值（'${WEB_ROOT}'）。在 entry.${KNOT_DOMAIN}.env 里写成这个子域自己的静态根，例如 /var/www/<标签>。" >&2
    exit 1
    ;;
  /*) ;;
  *)
    echo "入口 ${KNOT_DOMAIN} 的 KNOT_ENTRY_WEB_ROOT 必须是绝对路径：${WEB_ROOT}" >&2
    exit 1
    ;;
esac

# 中转文件一次一换。入口主机常常同时服务多个子域：固定用 /tmp/knot-discover.json 时，
# 两次推送共用同一个中转文件——A 传到一半、B 覆盖，最后 sudo cp 装进 A 的静态根的
# 可能是 B 的快照。mktemp 建的目录是 0700，别人预置不了同名路径；装完即删。
REMOTE_STAGE="$(ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" 'mktemp -d /tmp/knot-discover.XXXXXX' | tail -n 1)"
case "$REMOTE_STAGE" in
  /*) ;;
  *) echo "入口主机没有返回可用的中转目录：'${REMOTE_STAGE}'" >&2; exit 1 ;;
esac
# 下面要把它拼进 root 执行的命令里，只认自己验证过的字符集。
case "$REMOTE_STAGE" in
  *[!A-Za-z0-9._/-]*) echo "中转目录路径里有意外字符：'${REMOTE_STAGE}'" >&2; exit 1 ;;
esac

CHOWN_CMD=""
if [[ -n "$KNOT_ENTRY_WEB_OWNER" ]]; then
  CHOWN_CMD="sudo chown $KNOT_ENTRY_WEB_OWNER '$WEB_ROOT/discover.json'"
fi

# 这个 trap 顶掉前面那个只解锁的：两条清理都放在这里，免得后设的 trap
# 把先设的覆盖掉、锁一直留在 /tmp 里等下一次接管。
cleanup() {
  ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "rm -rf '$REMOTE_STAGE'" >/dev/null 2>&1 || true
  knot_unlock
}
trap cleanup EXIT

rsync -az -e "ssh ${SSH_OPTS[*]}" "$BOARD/discover.json" "$KNOT_ENTRY_SSH:$REMOTE_STAGE/discover.json"

ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "
  set -e
  sudo cp '$REMOTE_STAGE/discover.json' '$WEB_ROOT/discover.json'
  $CHOWN_CMD
"

echo "OK: discover snapshot → $WEB_ROOT"
