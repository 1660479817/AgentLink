#!/usr/bin/env bash
# 从开发机构建发布包，传到平台主机，在那边安装。
#
# 只传构建产物，不传源码：目标机不跑 npm ci，不跑 vite build。
# 目标主机、目录和私钥来自 sites/<站点>/site.env。
#
# 用法：
#   ./ops/scripts/push-deploy.sh --site local               # 本机整套系统，不 ssh
#   ./ops/scripts/push-deploy.sh --site bot01
#   ./ops/scripts/push-deploy.sh --site bot01 --variant lan
#   ./ops/scripts/push-deploy.sh --site bot01 --edge        # 装完再推云端边缘
#   ./ops/scripts/push-deploy.sh --site bot01 --no-build    # 用本地最新的发布包
#   ./ops/scripts/push-deploy.sh --site bot01 --artifact artifacts/knot-0.2.0-abc1234-darwin-arm64.tar.gz
#   ./ops/scripts/push-deploy.sh --site bot01 --dry-run     # 只检查，不动目标机
#   ./ops/scripts/push-deploy.sh --site local --runtime none # 本机，且不装成开机自启
#
# KNOT_DEPLOY_SSH 留空表示目标就是这台机器：构建、解包、装服务、探活都在本地做完，
# 部署根是仓库本身（sites/ 在那里），不 ssh、不 scp。开发者的 local 站点走这条路。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

SITE_ARG=""
VARIANT_ARG=""
ARTIFACT_ARG=""
BUILD=1
SKIP_TEST=0
PUSH_EDGE=0
DRY_RUN=0
RUNTIME_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--site 后面要跟站点名" >&2; exit 2; }
      SITE_ARG="$2"
      shift 2
      ;;
    --variant | --profile)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "$1 后面要跟变体名" >&2; exit 2; }
      VARIANT_ARG="$2"
      shift 2
      ;;
    --artifact)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--artifact 后面要跟 tar.gz" >&2; exit 2; }
      ARTIFACT_ARG="$2"
      shift 2
      ;;
    --no-build)
      BUILD=0
      shift
      ;;
    --skip-test)
      SKIP_TEST=1
      shift
      ;;
    --edge)
      PUSH_EDGE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --runtime)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--runtime 后面要跟 launchd / systemd / none" >&2; exit 2; }
      case "$2" in
        launchd | systemd | none) RUNTIME_ARG="$2" ;;
        *) echo "--runtime 只接受 launchd / systemd / none，现在是 $2" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done
[[ -n "$SITE_ARG" ]] && export KNOT_SITE="$SITE_ARG"
[[ -n "$VARIANT_ARG" ]] && export KNOT_SITE_VARIANT="$VARIANT_ARG"

# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

knot_require KNOT_PUBLIC_ORIGIN "在 sites/$KNOT_SITE/site.env 里写 KNOT_PUBLIC_ORIGIN。"

# KNOT_DEPLOY_SSH 留空 = 目标就是这台机器。开发者的 local 站点用它：
# 构建后直接就地安装，不走 ssh/scp，部署根是仓库本身（sites/ 在这里）。
LOCAL_DEPLOY=0
if [[ -z "${KNOT_DEPLOY_SSH:-}" ]]; then
  LOCAL_DEPLOY=1
fi

# 纯本地部署不该顺带推云端。配置里 KNOT_EDGE=0 时，--edge 直接报错，
# 免得以为在测本地、实际上把边缘改了。
if [[ "$PUSH_EDGE" == 1 ]] && ! knot_enabled KNOT_EDGE; then
  knot_fail "当前站点配置 KNOT_EDGE=0，不能加 --edge。要推边缘请用带 KNOT_EDGE=1 的配置。"
fi

# 先在开发机校验一遍，别把错的配置运到平台主机再回滚。
echo "==> config sites/$KNOT_SITE/site.env${KNOT_SITE_VARIANT:+ + site.$KNOT_SITE_VARIANT.env}"
CHECK_ARGS=(--site "$KNOT_SITE")
[[ -n "$KNOT_SITE_VARIANT" ]] && CHECK_ARGS+=(--variant "$KNOT_SITE_VARIANT")
node "$SCRIPT_DIR/config.mjs" check "${CHECK_ARGS[@]}"

# ---- 1. 发布包 ----
if [[ -z "$ARTIFACT_ARG" ]]; then
  if [[ "$BUILD" == 1 ]]; then
    BUILD_ARGS=(--out "$KNOT_ARTIFACT_DIR")
    [[ "$SKIP_TEST" == 1 ]] && BUILD_ARGS+=(--skip-test)
    "$SCRIPT_DIR/build.sh" "${BUILD_ARGS[@]}"
  fi
  ARTIFACT_ARG="$(node "$SCRIPT_DIR/artifact.mjs" latest "$KNOT_ARTIFACT_DIR")"
fi
[[ -f "$ARTIFACT_ARG" ]] || knot_fail "找不到发布包：$ARTIFACT_ARG"
ARTIFACT_DIR="$(cd "$(dirname "$ARTIFACT_ARG")" && pwd)"
ARTIFACT="$ARTIFACT_DIR/$(basename "$ARTIFACT_ARG")"
node "$SCRIPT_DIR/artifact.mjs" verify "$ARTIFACT" >/dev/null || knot_fail "发布包校验失败：$ARTIFACT"

PLATFORM="$(node "$SCRIPT_DIR/artifact.mjs" platform)"
ARTIFACT_BASE="$(basename "$ARTIFACT")"
case "$ARTIFACT_BASE" in
  *-"$PLATFORM".tar.gz) REL_NAME="${ARTIFACT_BASE%-"$PLATFORM".tar.gz}" ;;
  *) knot_fail "发布包名对不上这台机器的平台（${PLATFORM}）：$ARTIFACT_BASE" ;;
esac

# ---- 2. 本机安装（KNOT_DEPLOY_SSH 为空）----
if [[ "$LOCAL_DEPLOY" == 1 ]]; then
  # 本机部署根就是仓库：sites/ 在这里，releases/、current、var/ 也落在这里。
  DEPLOY_DIR="$APP"
  VERIFY_URL="${KNOT_DEPLOY_VERIFY_URL:-http://127.0.0.1:$KNOT_PORT/api/health}"

  echo "==> $REL_NAME  $PLATFORM"
  echo "    → 本机 $DEPLOY_DIR"

  if [[ "$DRY_RUN" == 1 ]]; then
    echo
    echo "dry-run：本地检查通过，没有改动任何文件。"
    echo "  发布包  $ARTIFACT"
    echo "  部署根  $DEPLOY_DIR"
    echo "  装到    $DEPLOY_DIR/releases/$REL_NAME"
    echo "  探活    $VERIFY_URL"
    echo "  运行时  ${RUNTIME_ARG:-（按 uname 选）}"
    exit 0
  fi

  echo "==> install"
  DEPLOY_ARGS=(--site "$KNOT_SITE" --deploy-root "$DEPLOY_DIR" --artifact "$ARTIFACT")
  [[ -n "$KNOT_SITE_VARIANT" ]] && DEPLOY_ARGS+=(--variant "$KNOT_SITE_VARIANT")
  [[ -n "$RUNTIME_ARG" ]] && DEPLOY_ARGS+=(--runtime "$RUNTIME_ARG")
  "$SCRIPT_DIR/deploy-site.sh" "${DEPLOY_ARGS[@]}"

  echo "==> verify $VERIFY_URL"
  verified=0
  for _ in $(seq 1 30); do
    if curl -sf "$VERIFY_URL" >/dev/null 2>&1; then
      verified=1
      break
    fi
    sleep 1
  done
  if [[ "$verified" != 1 ]]; then
    knot_fail "健康检查没有通过：$VERIFY_URL。看 $DEPLOY_DIR/var/log/ 里的日志。"
  fi
  curl -sf -o /dev/null -w "web %{http_code}\n" "http://127.0.0.1:$KNOT_PORT/"

  echo "OK: $KNOT_PUBLIC_ORIGIN"
  echo "    $REL_NAME"
  echo "    本机 http://127.0.0.1:$KNOT_PORT"
  if ! knot_enabled KNOT_EDGE; then
    echo "    KNOT_EDGE=0：这次没有推云端边缘。"
  elif [[ "$PUSH_EDGE" != 1 ]]; then
    knot_warn "边缘没有更新：各入口的静态根还是上一版 dist，而 /api 已经指向新后端。
    要一起推加 --edge：./ops/scripts/push-deploy.sh --site $KNOT_SITE --edge"
  fi
  echo "    登录：./ops/scripts/local-login.sh --site $KNOT_SITE"

  if [[ "$PUSH_EDGE" == 1 ]]; then
    echo "==> push edge"
    EDGE_ARGS=(--site "$KNOT_SITE")
    [[ -n "$KNOT_SITE_VARIANT" ]] && EDGE_ARGS+=(--variant "$KNOT_SITE_VARIANT")
    "$SCRIPT_DIR/push-edge.sh" "${EDGE_ARGS[@]}"
  fi
  exit 0
fi

# ---- 3. 连目标机 ----
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
PUBLISH_KEY="$(knot_expand_path "$KNOT_DEPLOY_SSH_KEY")"
if [[ -n "$PUBLISH_KEY" ]]; then
  SSH_OPTS+=(-i "$PUBLISH_KEY")
fi

PASS="${DEPLOY_SSH_PASS:-${E2E_SSH_PASS:-${SSHPASS:-}}}"
if [[ -n "$PASS" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    knot_fail "需要 sshpass：brew install sshpass"
  fi
  export SSHPASS="$PASS"
  SSH_OPTS+=(-o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPrompts=1)
  RSYNC_E="sshpass -e ssh ${SSH_OPTS[*]}"
  RUN_SSH=(sshpass -e ssh "${SSH_OPTS[@]}")
else
  RSYNC_E="ssh ${SSH_OPTS[*]}"
  RUN_SSH=(ssh "${SSH_OPTS[@]}")
fi

# 把本机展开过的 ~ 换成目标机的 home。配置里的 `~` 在被 source 时
# 会先展开成本机 home，直接当远端路径会写到不存在的地方。
DEPLOY_DIR="$KNOT_DEPLOY_DIR"
REMOTE_HOME="$("${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" 'printf %s "$HOME"')"
case "$DEPLOY_DIR" in
  "~") DEPLOY_DIR="$REMOTE_HOME" ;;
  "~/"*) DEPLOY_DIR="$REMOTE_HOME/${DEPLOY_DIR#\~/}" ;;
  "$HOME") DEPLOY_DIR="$REMOTE_HOME" ;;
  "$HOME"/*) DEPLOY_DIR="$REMOTE_HOME${DEPLOY_DIR#"$HOME"}" ;;
esac

echo "==> $REL_NAME  $PLATFORM"
echo "    → $KNOT_DEPLOY_SSH:$DEPLOY_DIR"

if [[ "$DRY_RUN" == 1 ]]; then
  echo
  echo "dry-run：本地检查通过，没有改动目标机。"
  echo "  发布包  $ARTIFACT"
  echo "  目标    $KNOT_DEPLOY_SSH:$DEPLOY_DIR/releases/$REL_NAME"
  exit 0
fi

# ---- 4. 传发布包和站点配置 ----
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "mkdir -p '$DEPLOY_DIR/artifacts' '$DEPLOY_DIR/.incoming' '$DEPLOY_DIR/sites/$KNOT_SITE' && chmod 700 '$DEPLOY_DIR/sites/$KNOT_SITE'"

echo "==> upload artifact"
rsync -az -e "$RSYNC_E" "$ARTIFACT" "$ARTIFACT.sha256" "$KNOT_DEPLOY_SSH:$DEPLOY_DIR/artifacts/"

# 站点配置不进发布包：它属于这台机器，而且 platform.env 里有密钥。
REMOTE_SITE="sites/$KNOT_SITE"
echo "==> site → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_SITE/site.env"
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "cat > '$DEPLOY_DIR/$REMOTE_SITE/site.env' && chmod 600 '$DEPLOY_DIR/$REMOTE_SITE/site.env'" <"$KNOT_SITE_ENV"
if [[ -n "$KNOT_SITE_OVERLAY" ]]; then
  REMOTE_OVERLAY="$REMOTE_SITE/$(basename "$KNOT_SITE_OVERLAY")"
  echo "==> variant → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_OVERLAY"
  "${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "cat > '$DEPLOY_DIR/$REMOTE_OVERLAY' && chmod 600 '$DEPLOY_DIR/$REMOTE_OVERLAY'" <"$KNOT_SITE_OVERLAY"
fi

# 公网入口也随站点走：目标机上的 push-discover.sh 要按规范入口找静态根，
# 在目标机上补推边缘时也要读这些文件。少传一份，那边就只能用默认值猜。
for entry_file in "$KNOT_SITE_DIR"/edge.*.env; do
  [[ -f "$entry_file" ]] || continue
  REMOTE_ENTRY="$REMOTE_SITE/$(basename "$entry_file")"
  echo "==> entry → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_ENTRY"
  "${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "cat > '$DEPLOY_DIR/$REMOTE_ENTRY' && chmod 600 '$DEPLOY_DIR/$REMOTE_ENTRY'" <"$entry_file"
done

# ---- 5. 在目标机解包并安装 ----
REMOTE_ARGS="--site '$KNOT_SITE' --deploy-root '$DEPLOY_DIR'"
[[ -n "$KNOT_SITE_VARIANT" ]] && REMOTE_ARGS="$REMOTE_ARGS --variant '$KNOT_SITE_VARIANT'"
[[ -n "$RUNTIME_ARG" ]] && REMOTE_ARGS="$REMOTE_ARGS --runtime '$RUNTIME_ARG'"

echo "==> remote install"
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "
  set -e
  INCOMING='$DEPLOY_DIR/.incoming/$REL_NAME'
  rm -rf \"\$INCOMING\"
  mkdir -p \"\$INCOMING\"
  tar -xzf '$DEPLOY_DIR/artifacts/$ARTIFACT_BASE' -C \"\$INCOMING\"
  KNOT_DEPLOY_ROOT='$DEPLOY_DIR' \"\$INCOMING/$REL_NAME/ops/scripts/deploy-site.sh\" $REMOTE_ARGS
  rm -rf \"\$INCOMING\"
"

# ---- 6. 验收 ----
VERIFY_URL="$KNOT_DEPLOY_VERIFY_URL"
if [[ -z "$VERIFY_URL" ]]; then
  VERIFY_URL="http://${KNOT_DEPLOY_SSH#*@}:$KNOT_PORT/api/health"
fi

echo "==> verify $VERIFY_URL"
verified=0
for _ in $(seq 1 30); do
  if curl -sf "$VERIFY_URL" >/dev/null 2>&1; then
    verified=1
    break
  fi
  sleep 1
done
if [[ "$verified" != 1 ]]; then
  knot_fail "健康检查没有通过：$VERIFY_URL"
fi
curl -sf -o /dev/null -w "web %{http_code}\n" "http://${KNOT_DEPLOY_SSH#*@}:$KNOT_PORT/"
echo "OK: $KNOT_PUBLIC_ORIGIN"
echo "    $REL_NAME"
echo "    平台主机 http://${KNOT_DEPLOY_SSH#*@}:$KNOT_PORT"
if ! knot_enabled KNOT_EDGE; then
  echo "    KNOT_EDGE=0：这次没有推云端边缘。"
elif [[ "$PUSH_EDGE" != 1 ]]; then
  # KNOT_EDGE=1 但没带 --edge：边缘仍是上一版页面。
  # 这不算错误（有时只想起平台主机），但接口已经是新的、页面还是旧的，
  # 表现就是「本地能看到内容，公网域名什么都没有」。必须说出来。
  knot_warn "边缘没有更新：各入口的静态根还是上一版 dist，而 /api 已经指向新后端。
    要一起推加 --edge：./ops/scripts/push-deploy.sh --site $KNOT_SITE --edge"
fi

if [[ "$PUSH_EDGE" == 1 ]]; then
  echo "==> push edge"
  EDGE_ARGS=(--site "$KNOT_SITE")
  [[ -n "$KNOT_SITE_VARIANT" ]] && EDGE_ARGS+=(--variant "$KNOT_SITE_VARIANT")
  "$SCRIPT_DIR/push-edge.sh" "${EDGE_ARGS[@]}"
fi
