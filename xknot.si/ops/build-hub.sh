#!/usr/bin/env bash
# 在本机构建中枢门户：校验 → 探测 → 安装依赖 → 构建 → 写数据快照 → 抓取入口。
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
node "$HUB/ops/validate-federation.mjs"

if [ "$OFFLINE" = "1" ]; then
  echo "== probe (skipped) =="
  echo "== fetch (skipped) =="
else
  echo "== probe =="
  node "$HUB/ops/check-health.mjs"

  # 伙伴地址取不到时保留上一份，构建照常继续。
  echo "== fetch =="
  node "$HUB/ops/fetch-profile.mjs"
  node "$HUB/ops/fetch-cards.mjs"
  node "$HUB/ops/fetch-stats.mjs"
fi

if [ ! -d "$WEB/node_modules" ]; then
  echo "== install =="
  npm --prefix "$WEB" ci --no-audit --no-fund
fi

# 上一次安装中断留下的半棵树、或 package-lock.json 改过而 node_modules 还在，
# 都会让构建继续用旧依赖：同一个 commit 在不同机器上产出不同的 dist。
# npm 安装时会写下 node_modules/.package-lock.json，比当前的 lock 旧就重装。
if [ -d "$WEB/node_modules" ]; then
  if [ ! -f "$WEB/node_modules/.package-lock.json" ] || [ "$WEB/package-lock.json" -nt "$WEB/node_modules/.package-lock.json" ]; then
    echo "== reinstall (lock changed) =="
    npm --prefix "$WEB" ci --no-audit --no-fund
  fi
fi

# ops/ 里只有 render-knot-help.mjs 需要依赖（marked，构建时用）。缺了就装，
# 不让构建因为少包直接失败。
if [ ! -d "$HUB/node_modules" ]; then
  echo "== install ops =="
  npm --prefix "$HUB" ci --no-audit --no-fund
elif [ ! -f "$HUB/node_modules/.package-lock.json" ] || [ "$HUB/package-lock.json" -nt "$HUB/node_modules/.package-lock.json" ]; then
  echo "== reinstall ops (lock changed) =="
  npm --prefix "$HUB" ci --no-audit --no-fund
fi

echo "== build =="
npm --prefix "$WEB" run build

# Agent 指引由构建产出：/knot-help（HTML）与 /knot-help.md（原文）都落进 dist。
echo "== knot-help =="
node "$HUB/ops/render-knot-help.mjs" --out "$DIST"

echo "== snapshot =="
XKNOT_PREVIEW="$PREVIEW" node "$HUB/ops/build-hub-data.mjs" --out "$DIST/data/hub.json"

# 抓取入口与无脚本目录：robots、sitemap，以及每个语种一份 /instances/ 静态页。
# 目录读的就是上一步写出的快照，与门户上看到的是同一份数据。
echo "== seo =="
node "$HUB/ops/build-seo.mjs" --dist "$DIST" --origin "${XKNOT_HUB_ORIGIN:-https://xknot.si}"

echo "== verify =="
if [ "$PREVIEW" = "1" ]; then
  node "$HUB/ops/verify-hub-data.mjs" \
    --data "$DIST/data/hub.json" \
    --instances "$HUB/instances.json" \
    --fixtures "$HUB/fixtures/preview-instances.json" \
    --allow-missing-profile
else
  node "$HUB/ops/verify-hub-data.mjs" \
    --data "$DIST/data/hub.json" \
    --instances "$HUB/instances.json"
fi

echo "done: $DIST"
