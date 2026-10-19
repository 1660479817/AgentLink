#!/usr/bin/env bash
# 在本机构建中枢门户：校验 → 探测 → 安装依赖 → 构建 → 写数据快照。
#
# 全部步骤在本机完成，不连接 bot01，不推送任何远端。
# 产物是 xknot.si/web/dist，可以直接用任意静态服务器或 `npm run preview` 查看。
#
# 用法：
#   ./ops/build-hub.sh              # 正常构建，先探测一次
#   ./ops/build-hub.sh --offline    # 跳过探测，复用 var/health.json
#   ./ops/build-hub.sh --preview    # 并入 fixtures/ 样例条目，只用于看版式

set -euo pipefail

HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$HUB/web"
DIST="$WEB/dist"

OFFLINE=0
PREVIEW=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    --preview) PREVIEW=1; OFFLINE=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$PREVIEW" = "1" ]; then
  echo "== preview =="
  echo "fixtures/preview-instances.json 会并入本次构建，不写回 instances.json"
  node "$HUB/ops/validate-instances.mjs" --instances "$HUB/fixtures/preview-instances.json"
fi

echo "== validate =="
node "$HUB/ops/validate-instances.mjs"

if [ "$OFFLINE" = "1" ]; then
  echo "== probe (skipped) =="
else
  echo "== probe =="
  node "$HUB/ops/check-health.mjs"
fi

if [ ! -d "$WEB/node_modules" ]; then
  echo "== install =="
  npm --prefix "$WEB" ci --no-audit --no-fund
fi

echo "== build =="
npm --prefix "$WEB" run build

echo "== snapshot =="
XKNOT_PREVIEW="$PREVIEW" node "$HUB/ops/build-hub-data.mjs" --out "$DIST/data/hub.json"

echo "done: $DIST"
