#!/usr/bin/env bash
# 本地部署门户：校验 → 构建 → 起接口 → 起本机边缘。
#
# 线上是 `/opt/xknot` 的接口进程 + nginx；本地把这两层拆成
# `server/index.mjs` 和 `ops/local-hub.mjs`，路径与响应头按
# `ops/xknot.si.conf` 复刻，所以端到端测到的行为与线上一致。
#
# 用法：
#   ./ops/deploy-local.sh                      # 校验、构建、启动，数据在 var/local
#   ./ops/deploy-local.sh --no-build           # 复用 web/dist，不再构建
#   ./ops/deploy-local.sh --offline            # 构建但跳过伙伴探活
#   ./ops/deploy-local.sh --preview            # 门户并进 fixtures 样例
#   ./ops/deploy-local.sh --admin paul:secret  # 顺便用运维命令建管理员
#   ./ops/deploy-local.sh --port 8080          # 换端口（默认 5190，5180 留给 npm run dev）
#   ./ops/deploy-local.sh --data-dir /tmp/k    # 换数据目录（默认 var/local）
#
# 数据目录保留，重启后申请与审核记录还在。Ctrl-C 同时收掉接口与边缘。

set -euo pipefail

HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD=1
BUILD_FLAGS=()
STACK_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0; shift ;;
    --offline) BUILD_FLAGS+=(--offline); shift ;;
    --preview) BUILD_FLAGS+=(--preview); STACK_ARGS+=(--preview); shift ;;
    --admin)
      [ $# -ge 2 ] || { echo "--admin 需要 <user>:<password>" >&2; exit 2; }
      STACK_ARGS+=(--admin "$2")
      shift 2
      ;;
    --port)
      [ $# -ge 2 ] || { echo "--port 需要端口号" >&2; exit 2; }
      STACK_ARGS+=(--port "$2")
      shift 2
      ;;
    --data-dir)
      [ $# -ge 2 ] || { echo "--data-dir 需要目录" >&2; exit 2; }
      STACK_ARGS+=(--data-dir "$2")
      shift 2
      ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ "$BUILD" = "1" ]; then
  "$HUB/ops/build-hub.sh" ${BUILD_FLAGS[@]+"${BUILD_FLAGS[@]}"}
fi

if [ ! -f "$HUB/web/dist/index.html" ]; then
  echo "web/dist 不存在；先跑 ./ops/build-hub.sh，或去掉 --no-build" >&2
  exit 1
fi

exec node "$HUB/ops/local-stack.mjs" ${STACK_ARGS[@]+"${STACK_ARGS[@]}"}
