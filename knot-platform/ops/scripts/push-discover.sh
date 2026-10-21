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
[[ -n "$WEB_ROOT" ]] || WEB_ROOT="$KNOT_ENTRY_WEB_ROOT"

rsync -az -e "ssh ${SSH_OPTS[*]}" "$BOARD/discover.json" "$KNOT_ENTRY_SSH:/tmp/knot-discover.json"

CHOWN_CMD=""
if [[ -n "$KNOT_ENTRY_WEB_OWNER" ]]; then
  CHOWN_CMD="sudo chown $KNOT_ENTRY_WEB_OWNER '$WEB_ROOT/discover.json'"
fi

ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "
  set -e
  sudo cp /tmp/knot-discover.json '$WEB_ROOT/discover.json'
  $CHOWN_CMD
"

echo "OK: discover snapshot → $WEB_ROOT"
