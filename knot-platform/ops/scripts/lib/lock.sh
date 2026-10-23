#!/usr/bin/env bash
# 脚本级的互斥锁：同一个操作同时跑两份，会互相覆盖对方的中间结果。
#
# 用目录当锁——mkdir 是原子的，不依赖 flock（macOS 自带 bash 没有 util-linux 那套）。
#
#   1. mkdir 成功 = 拿到锁，把自己的 pid 写进去；
#   2. mkdir 失败 = 有人拿着，先看它还在不在；
#   3. pid 已经不存在 = 上次被强杀，接管残留锁（只警告，不替它收尾）。
#
# 释放只删自己拿的那把：接管过别人的之后，别把继任者的锁一起删掉。
#
# 用法：
#   source "$SCRIPT_DIR/lib/lock.sh"
#   knot_lock "$KNOT_DEPLOY_ROOT/.backup.lock" "备份"
#   ...
#   knot_unlock
#
# 调用方应当 `trap knot_unlock EXIT`，或者在正常路径末尾显式调用。本文件不装 trap：
# 有的脚本在拿到锁之前就要装自己的 cleanup trap，抢 trap 会互相顶掉。
#
# 兼容 macOS 自带的 bash 3.2：不用关联数组、不用 mapfile。

KNOT_LOCK_DIR=""

# knot_lock <锁目录> <操作名>
# 拿到返回 0；拿不到返回非 0（调用方应 exit，不要再往下跑）。
knot_lock() {
  local dir="$1"
  local action="${2:-操作}"
  local holder

  mkdir -p "$(dirname "$dir")" 2>/dev/null || true

  if mkdir "$dir" 2>/dev/null; then
    KNOT_LOCK_DIR="$dir"
    printf '%s\n' "$$" > "$dir/pid"
    return 0
  fi

  holder="$(cat "$dir/pid" 2>/dev/null || echo "")"
  if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
    echo "另一个${action}正在跑（pid ${holder}），本次不动手。" >&2
    echo "等它结束再重试；确认它卡死了，先看 ${dir}，再手动删掉。" >&2
    return 1
  fi

  # 持锁进程已经不在了：上次被强杀，没来得及清理。接管它。
  echo "接管残留的${action}锁（pid ${holder:-未知} 已不存在）。" >&2
  rm -rf "$dir"
  if ! mkdir "$dir" 2>/dev/null; then
    echo "抢不到${action}锁：${dir}" >&2
    return 1
  fi
  KNOT_LOCK_DIR="$dir"
  printf '%s\n' "$$" > "$dir/pid"
  return 0
}

# 释放自己拿的锁。没拿过、或者锁已被别人接管，就什么都不做。
knot_unlock() {
  [[ -n "${KNOT_LOCK_DIR:-}" && -f "$KNOT_LOCK_DIR/pid" ]] || return 0
  if [[ "$(cat "$KNOT_LOCK_DIR/pid" 2>/dev/null || echo "")" == "$$" ]]; then
    rm -rf "$KNOT_LOCK_DIR"
  fi
  KNOT_LOCK_DIR=""
  return 0
}
