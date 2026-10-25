#!/usr/bin/env bash
# 常驻进程的文件描述符上限。
#
# 一个连接就是一个 fd。入口的隧道进程每转发一条 TCP 都要开一个 socket，
# Backend 每接受一条连接也要开一个。launchd 给常驻任务的软限是 256
# （darwin 默认，硬限通常是 unlimited），于是并发一过两百，隧道先报
# "socket: Too many open files"，把新连接直接 reset，入口看到的就是 502，
# 而 Backend 自己还没到忙的那一步：瓶颈在 fd，不在 CPU、不在库。
#
# 这里只抬软限（ulimit -Sn），不动硬限，也不改系统设置：`ulimit -n`
# 在 bash 里会同时改软硬两档，硬限一旦降下来就再也抬不回去。
# 抬不到目标值就退到硬限，仍然失败只警告一句就继续启动：
# 少几个并发，好过起不来。
#
# 为什么是 8192：300 个并发读者在入口同时占隧道连接，加上 Backend 的
# 数据库连接、上传文件和日志，两千以内就够；8192 在 darwin 的
# kern.maxfilesperproc（10240）之下，留出别的进程的余量。
#
# 用法（在 exec 之前 source 一次）：
#   source "$SCRIPT_DIR/lib/fd-limit.sh"
#   knot_raise_fd_limit

KNOT_FD_LIMIT_TARGET=8192

# knot_raise_fd_limit [目标值]
# 已经是目标值或更高就不动；任何一步失败都不返回非零，调用方不必判错。
knot_raise_fd_limit() {
  local target="${1:-$KNOT_FD_LIMIT_TARGET}"
  local current hard
  current="$(ulimit -n 2>/dev/null || echo 0)"
  [[ "$current" =~ ^[0-9]+$ ]] || current=0
  if [[ "$current" -ge "$target" ]]; then
    return 0
  fi
  hard="$(ulimit -Hn 2>/dev/null || echo "")"
  if [[ "$hard" =~ ^[0-9]+$ && "$hard" -lt "$target" ]]; then
    target="$hard"
  fi
  # -S 只改软限；不支持 -S 的 shell 退到 -n（会连硬限一起改，但好过抬不动）。
  ulimit -Sn "$target" 2>/dev/null || ulimit -n "$target" 2>/dev/null || true
  current="$(ulimit -n 2>/dev/null || echo 0)"
  [[ "$current" =~ ^[0-9]+$ ]] || current=0
  if [[ "$current" -lt "$target" ]]; then
    echo "文件描述符软限只抬到 ${current}（目标 ${target}）：并发高时可能拒绝新连接。" >&2
  fi
  return 0
}
