#!/usr/bin/env bash
# 把发现页公开快照推到云端边缘的 WebUI 目录。
#
# 平台在内容变化后调用它。边缘主机来自 sites/<站点>/site.env（KNOT_EDGE=1、KNOT_EDGE_SSH）；
# 落到哪几个目录来自 sites/<站点>/edge.<域名>.env：
#
#   每个 staff 发布、static 投放的入口都收一份。
#
# 为什么是每个而不是只推规范入口：nginx 的 /discover.json 是 try_files 先看磁盘再看隧道，
# 非规范入口只要磁盘上留着一份旧文件，就永远命中旧的、不会回落到平台。
# 快照只有几十 KB，一份一份推过去比让读者穿隧道取更划算。
#
# proxy 投放的入口不需要：它的 / 与 /discover.json 本来就整段回源。
#
# 用法：push-discover.sh /path/to/board
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

BOARD="${1:?board directory}"

if ! knot_enabled KNOT_EDGE; then
  echo "KNOT_EDGE 未开启，快照只留在 $BOARD"
  exit 0
fi
knot_require KNOT_EDGE_SSH "在 sites/$KNOT_SITE/site.env 里配置 KNOT_EDGE_SSH=user@edge-host。"

if [[ ! -f "$BOARD/discover.json" ]]; then
  echo "missing $BOARD/discover.json" >&2
  exit 1
fi

SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
# 平台主机用 KNOT_EDGE_PUSH_KEY；旧机器把它写在运行时文件的 KNOT_EDGE_SSH_KEY 里。
# KNOT_EDGE_PUSH_KEY 有默认路径，所以默认路径不存在时再退回旧键。
EDGE_KEY="$(knot_expand_path "${KNOT_EDGE_PUSH_KEY:-}")"
if [[ ! -f "$EDGE_KEY" && -n "${KNOT_EDGE_SSH_KEY:-}" ]]; then
  EDGE_KEY="$(knot_expand_path "$KNOT_EDGE_SSH_KEY")"
fi
if [[ -n "$EDGE_KEY" ]]; then
  SSH_OPTS+=(-i "$EDGE_KEY")
fi

# 收快照的静态根。没有入口文件时退回站点级的 KNOT_EDGE_WEB_ROOT，兼容还没有入口配置的旧部署。
ENTRY_ROOTS=()
for entry_file in "$KNOT_SITE_DIR"/edge.*.env; do
  [[ -f "$entry_file" ]] || continue
  serve="$(knot_entry_value "$entry_file" KNOT_ENTRY_SERVE)"
  publisher="$(knot_entry_value "$entry_file" KNOT_ENTRY_PUBLISHER)"
  # 空值等于默认：static、staff。
  [[ "${serve:-static}" == "static" ]] || continue
  [[ "${publisher:-staff}" == "staff" ]] || continue
  root="$(knot_entry_value "$entry_file" KNOT_EDGE_WEB_ROOT)"
  [[ -n "$root" ]] && ENTRY_ROOTS+=("$root")
done
if [[ ${#ENTRY_ROOTS[@]} -eq 0 ]]; then
  ENTRY_ROOTS=("$KNOT_EDGE_WEB_ROOT")
fi

mkdir -p "$BOARD/media/previews"
rsync -az -e "ssh ${SSH_OPTS[*]}" "$BOARD/discover.json" "$KNOT_EDGE_SSH:/tmp/knot-discover.json"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$BOARD/media/previews/" "$KNOT_EDGE_SSH:/tmp/knot-previews/"

CHOWN_CMD=""
if [[ -n "$KNOT_EDGE_WEB_OWNER" ]]; then
  CHOWN_CMD="sudo chown -R $KNOT_EDGE_WEB_OWNER"
fi

# 一次 ssh 装完所有入口：每个入口一次往返，慢的是连接不是拷贝。
REMOTE="set -e"
i=0
for root in "${ENTRY_ROOTS[@]}"; do
  i=$((i + 1))
  REMOTE="$REMOTE
  sudo mkdir -p '$root/media/previews'
  sudo cp /tmp/knot-discover.json '$root/discover.json'
  sudo rsync -a --delete /tmp/knot-previews/ '$root/media/previews/'"
  [[ -n "$CHOWN_CMD" ]] && REMOTE="$REMOTE
  $CHOWN_CMD '$root/discover.json' '$root/media'"
done

ssh "${SSH_OPTS[@]}" "$KNOT_EDGE_SSH" "$REMOTE"

echo "OK: discover snapshot → $i 个入口（${ENTRY_ROOTS[*]}）"
