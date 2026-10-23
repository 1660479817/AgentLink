#!/usr/bin/env bash
# 在开发机上构建一个可交付的 Knot 发布包。
#
# 产出（默认在 <knot-platform>/artifacts/）：
#   knot-<版本>-<提交>-<平台>.tar.gz        解包即一个可运行的代码目录
#   knot-<版本>-<提交>-<平台>.tar.gz.sha256
#
# 包里是：backend/、packages/、web/dist/、admin/、ops/、生产依赖的 node_modules/、BUILD.json。
# 不含 sites/（配置在目标机上）、var/（数据在目标机上）、.git。
#
# 部署机只负责解包、迁移、切换、重启，不跑 npm ci，不跑 vite build。
#
# 用法：
#   ./ops/scripts/build.sh
#   ./ops/scripts/build.sh --skip-test        # 跳过单测（不推荐）
#   ./ops/scripts/build.sh --skip-install     # 复用现有 node_modules
#   ./ops/scripts/build.sh --no-modules       # 不带 node_modules；只用于手工拷到别处自己装，
#                                            # deploy-site.sh 会拒绝这种包（目标机不跑 npm ci）
#   ./ops/scripts/build.sh --out /tmp/knot-artifacts
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
NODE="$(command -v node || true)"

OUT=""
RUN_TEST=1
RUN_INSTALL=1
WITH_MODULES=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--out 后面要跟目录" >&2; exit 2; }
      OUT="$2"
      shift 2
      ;;
    --skip-test)
      RUN_TEST=0
      shift
      ;;
    --skip-install)
      RUN_INSTALL=0
      shift
      ;;
    --no-modules)
      WITH_MODULES=0
      shift
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "错误：$*" >&2
  exit 1
}

[[ -n "$NODE" ]] || fail "需要 node（建议 22+）。"
command -v npm >/dev/null 2>&1 || fail "需要 npm。"
[[ -f "$APP/backend/package.json" && -d "$APP/web" && -d "$APP/packages" ]] ||
  fail "$APP 不像 knot-platform 源码目录。请在源码目录里构建。"

# 发布包里没有构建工具，也不该在发布包上再构建一次。
if [[ "$(basename "$(dirname "$APP")")" == "releases" ]]; then
  fail "当前目录是已安装的发布包，构建请回到源码目录。"
fi

OUT="${OUT:-$APP/artifacts}"
mkdir -p "$OUT"

VERSION="$("$NODE" -p "require('$APP/backend/package.json').version")"
COMMIT="$(git -C "$APP" rev-parse --short HEAD 2>/dev/null || echo nogit)"
DIRTY=""
if [[ "$COMMIT" != "nogit" ]] && [[ -n "$(git -C "$APP" status --porcelain --untracked-files=no 2>/dev/null | head -c 1)" ]]; then
  DIRTY=1
  echo "警告：工作区有未提交的改动，发布包会标记为 dirty。"
fi
PLATFORM="$("$NODE" "$SCRIPT_DIR/artifact.mjs" platform)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BUILD_DISPLAY="$VERSION${DIRTY:+（dirty）}"

echo "==> knot $BUILD_DISPLAY  $COMMIT  $PLATFORM"

if [[ "$RUN_INSTALL" == 1 ]]; then
  echo "==> npm ci"
  npm --prefix "$APP" ci
fi

if [[ "$RUN_TEST" == 1 ]]; then
  echo "==> npm test"
  # 单测必须与部署环境隔离。运维按 ops/README 的写法 `set -a; . sites/<站点>/platform.env; set +a`
  # 之后，这些变量会留在当前 shell：KNOT_AGENT_ENV_DIR / KNOT_PROFILE_FILE 会让
  # loadBootstrapConfig 读到某个真实站点的档案与公开地址，而测试断言的是 schema 默认值，
  # 于是构建在「测试」这一步失败，报出来的却是分享海报文案之类的无关差异。
  # 构建只打包，不该受「哪个站点的配置被 source 过」影响，所以这里用干净环境跑。
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" npm --prefix "$APP" test
fi

echo "==> build web"
npm --prefix "$APP" run build:web

# 发布目录名和 BUILD.json 里的 release 字段一致；deploy-site.sh 用它决定装到哪。
STAGE_ROOT="$OUT/.staging"
RELEASE_NAME="$("$NODE" -e '
  const info = { version: process.argv[1], commit: process.argv[2], dirty: process.argv[3] === "1" };
  // 脏构建必须带时间戳：release 名决定 releases/ 下的目录名与 deployed.json 里的
  // previous。同一份 version+commit 连续打几次包时，不带戳会让两次发布用同一个目录，
  // 新包覆盖旧内容，回滚目标指向自己——回滚变成空操作。
  const stamp = process.argv[4] || "";
  const dirty = info.dirty ? `-dirty${stamp ? `-${stamp}` : ""}` : "";
  process.stdout.write(`knot-${info.version}-${info.commit}${dirty}`);
' "$VERSION" "$COMMIT" "${DIRTY:+1}" "$(date -u +%Y%m%d-%H%M%S)")"
STAGE="$STAGE_ROOT/$RELEASE_NAME"
rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "==> stage $RELEASE_NAME"
rsync -a \
  --exclude node_modules \
  --exclude artifacts \
  --exclude releases \
  --exclude current \
  --exclude deployed.json \
  --exclude var \
  --exclude .git \
  --exclude 'sites' \
  --exclude '.tmp-*' \
  --exclude 'web/dist' \
  --exclude '*.test.js' \
  --exclude '*.test.mjs' \
  --exclude '*.sync-conflict-*' \
  --exclude '*.bak' \
  "$APP/" "$STAGE/"
mkdir -p "$STAGE/web"
rsync -a "$APP/web/dist/" "$STAGE/web/dist/"

MODULES=0
if [[ "$WITH_MODULES" == 1 ]]; then
  echo "==> stage production node_modules"
  rsync -a "$APP/node_modules/" "$STAGE/node_modules/"
  # 去掉 vite / @vitejs 这类只在构建时用的包。离线可用，不重新下载。
  (cd "$STAGE" && npm prune --omit=dev --no-audit --no-fund >/dev/null)
  # prune 之后自己核一遍：真正的交付前提是「包里没有构建工具」，不是
  # 「prune 命令返回 0」。以后谁改了依赖结构，这里会先失败，而不是等到目标机。
  [[ ! -d "$STAGE/node_modules/vite" ]] ||
    { echo "prune 之后 node_modules 仍有 vite：生产依赖树没裁干净。" >&2; exit 1; }
  MODULES=1
fi

"$NODE" -e '
  const fs = require("node:fs");
  const [file, version, commit, dirty, platform, builtAt, modules, release] = process.argv.slice(1);
  const info = {
    version,
    commit,
    dirty: dirty === "1",
    platform,
    builtAt,
    node: process.version,
    modules: modules === "1",
    // 与目录名、tar 包名同一个来源：deploy-site.sh 拿 release 决定装到哪个目录，
    // 探活又拿它和 /api/health 的 release 比对，三处必须是同一个字符串。
    release,
  };
  fs.writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`);
' "$STAGE/BUILD.json" "$VERSION" "$COMMIT" "${DIRTY:+1}" "$PLATFORM" "$BUILT_AT" "$MODULES" "$RELEASE_NAME"

chmod +x "$STAGE/ops/scripts/"*.sh 2>/dev/null || true

TARBALL="$OUT/$RELEASE_NAME-$PLATFORM.tar.gz"
echo "==> tar $(basename "$TARBALL")"
rm -f "$TARBALL" "$TARBALL.sha256"
tar -czf "$TARBALL" -C "$STAGE_ROOT" "$RELEASE_NAME"
SUM="$("$NODE" "$SCRIPT_DIR/artifact.mjs" checksum "$TARBALL")"
printf '%s  %s\n' "$SUM" "$(basename "$TARBALL")" >"$TARBALL.sha256"
rm -rf "$STAGE"
rmdir "$STAGE_ROOT" 2>/dev/null || true

SIZE="$(du -h "$TARBALL" | awk '{print $1}')"
echo
echo "OK: $(basename "$TARBALL")  $SIZE"
echo "    release  $RELEASE_NAME"
echo "    sha256   $SUM"
echo "    下一步  ./ops/scripts/push-deploy.sh --site <站点>"
