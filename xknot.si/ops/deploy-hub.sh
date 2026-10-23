#!/usr/bin/env bash
# 把已构建的 dist 同步到静态托管目录。
#
# 这一步是可选的：门户在本机就能构建和预览，不需要先部署。
# 目标机器和目录都通过环境变量给出，脚本里不写死任何主机。
#
# 用法：
#   XKNOT_HUB_SSH=user@host ./ops/deploy-hub.sh
#   XKNOT_HUB_SSH=user@host XKNOT_TARGET=/var/www/xknot ./ops/deploy-hub.sh --dry-run
#
# 可覆盖的变量：
#   XKNOT_HUB_SSH      必填，如 user@192.0.2.10
#   XKNOT_TARGET    远端目录，默认 /var/www/xknot
#   XKNOT_SSH_KEY   私钥路径，默认 ~/.ssh/id_rsa

set -euo pipefail

HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$HUB/web/dist"

if [ ! -f "$DIST/index.html" ]; then
  echo "dist is missing; run ./ops/build-hub.sh first" >&2
  exit 1
fi

# 同步前再核一次：部署目录里不能有 fixtures 的样例条目。
echo "== verify =="
node "$HUB/ops/verify-hub-data.mjs" --data "$DIST/data/hub.json" --instances "$HUB/instances.json"

: "${XKNOT_HUB_SSH:?set XKNOT_HUB_SSH=user@host}"
# 显式给成空值（例如上游变量没展开）与「没给」不是一回事：前者多半是配错了，
# 按默认值继续跑会把删除落到一个操作者没打算碰的目录上，所以直接拒绝。
if [ "${XKNOT_TARGET+set}" = "set" ] && [ -z "$XKNOT_TARGET" ]; then
  echo "XKNOT_TARGET 是空值：拒绝部署。要默认目录就别设这个变量。" >&2
  exit 1
fi
TARGET="${XKNOT_TARGET:-/var/www/xknot}"
KEY="${XKNOT_SSH_KEY:-$HOME/.ssh/id_rsa}"

# rsync 的 -e 是一个字符串，由 rsync 自己再拆一次；路径里有空格时裸拼会把参数拆错。
# 单引号里放不下单引号，遇到就把那个引号拆成 '\''：先闭合、转义一个引号、再打开。
shq() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# 下面的同步带 --delete，删除范围就是 TARGET 这个目录。TARGET 少写一级（例如写成站点
# 父目录）就会把同机别的站点的静态根整目录删掉，所以先拒绝明显错的值。
# 不做交互确认：定时部署没有终端，卡在 read 上就等于永远不部署。
# 末尾斜杠不影响目标，但会让后面的比较对不上，先统一掉（根目录除外）。
if [ -n "$TARGET" ] && [ "$TARGET" != "/" ]; then
  TARGET="${TARGET%/}"
fi
case "$TARGET" in
  "" | "/")
    echo "XKNOT_TARGET 为空或就是根目录 /：--delete 会清掉整个目录，拒绝部署。" >&2
    exit 1
    ;;
  /var | /var/www | /opt | /usr | /etc | /home | /root | /srv)
    echo "XKNOT_TARGET='$TARGET' 是站点父目录，不是本站独占的目录：拒绝部署。" >&2
    exit 1
    ;;
  /*) ;;
  *)
    echo "XKNOT_TARGET='$TARGET' 不是绝对路径：远端目标要写全，拒绝部署。" >&2
    exit 1
    ;;
esac
# 目标是本次同步的源目录时，rsync 会在自己的输出目录里删东西。
# 远端目录与本地 dist 不会真是同一个 inode，但写成同一个路径通常是把变量接错了。
DIST_ABS="$(cd "$DIST" && pwd -P)"
if [ "$TARGET" = "$DIST" ] || [ "$TARGET" = "$DIST_ABS" ]; then
  echo "XKNOT_TARGET 与源目录相同：拒绝部署。" >&2
  exit 1
fi

DRY=0
RSYNC_ARGS=(-az --delete --itemize-changes
  --exclude .well-known
  -e "ssh -i $(shq "$KEY") -o StrictHostKeyChecking=accept-new")

if [ "${1:-}" = "--dry-run" ]; then
  DRY=1
  RSYNC_ARGS+=(--dry-run)
fi

echo "== deploy =="
echo "$DIST/ -> $XKNOT_HUB_SSH:$TARGET/"
if [ "$DRY" = "0" ]; then
  # 真删之前先把要删的路径打出来：日志里要能看出这次 --delete 动了什么。
  # 预览失败不在这里报错，让下面那次真同步去报，错误信息才落在同一处。
  DELETE_PLAN="$(rsync "${RSYNC_ARGS[@]}" --dry-run "$DIST/" "$XKNOT_HUB_SSH:$TARGET/" 2>/dev/null | grep '^\*deleting' || true)"
  if [ -n "$DELETE_PLAN" ]; then
    echo "--delete 将删除目标里 dist 没有的项："
    printf '%s\n' "$DELETE_PLAN"
  else
    echo "--delete：没有要删除的项。"
  fi
fi
rsync "${RSYNC_ARGS[@]}" "$DIST/" "$XKNOT_HUB_SSH:$TARGET/"
