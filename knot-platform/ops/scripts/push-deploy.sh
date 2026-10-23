#!/usr/bin/env bash
# 从开发机构建发布包，传到实例主机，在那边安装。
#
# 只传构建产物，不传源码：目标机不跑 npm ci，不跑 vite build。
# 目标主机、目录和私钥来自 sites/<站点>/site.env。
#
# 用法：
#   ./ops/scripts/push-deploy.sh --site local               # local：本机整套系统，不 ssh
#   ./ops/scripts/push-deploy.sh --site wang                # xknot.si 子域：装实例主机
#   ./ops/scripts/push-deploy.sh --site wang --entry        # 装完再推 xknot.si 子域入口
#   ./ops/scripts/push-deploy.sh --site wang --no-build    # 用本地最新的发布包
#   ./ops/scripts/push-deploy.sh --site wang --artifact artifacts/knot-0.2.0-abc1234-darwin-arm64.tar.gz
#   ./ops/scripts/push-deploy.sh --site wang --dry-run     # 只检查，不动目标机
#   ./ops/scripts/push-deploy.sh --site local --runtime none # local，且不装成开机自启
#
# KNOT_DEPLOY_SSH 留空表示目标就是这台机器：构建、解包、装服务、探活都在本地做完，
# 不 ssh、不 scp。部署根取 KNOT_DEPLOY_DIR（和仓库分开）；没配时才退回仓库本身。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

SITE_ARG=""
ARTIFACT_ARG=""
BUILD=1
SKIP_TEST=0
PUSH_ENTRY=0
DRY_RUN=0
RUNTIME_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--site 后面要跟站点名" >&2; exit 2; }
      SITE_ARG="$2"
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
    --entry)
      PUSH_ENTRY=1
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

# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

knot_require KNOT_PUBLIC_ORIGIN "在 sites/$KNOT_SITE/site.env 里写 KNOT_PUBLIC_ORIGIN。"

# KNOT_DEPLOY_SSH 留空 = 目标就是这台机器。开发者的 local 站点用它：
# 构建后直接就地安装，不走 ssh/scp。部署根取 KNOT_DEPLOY_DIR。
LOCAL_DEPLOY=0
if [[ -z "${KNOT_DEPLOY_SSH:-}" ]]; then
  LOCAL_DEPLOY=1
fi

# 纯本地部署不该顺带推入口主机。配置里 KNOT_ENTRY_ENABLED=0 时，--entry 直接报错，
# 免得以为在测本地、实际上把入口改了。
if [[ "$PUSH_ENTRY" == 1 ]] && ! knot_enabled KNOT_ENTRY_ENABLED; then
  knot_fail "当前站点配置 KNOT_ENTRY_ENABLED=0，不能加 --entry。要推入口请用带 KNOT_ENTRY_ENABLED=1 的配置。"
fi

# 先在开发机校验一遍，别把错的配置运到实例主机再回滚。
echo "==> config sites/$KNOT_SITE/site.env"
CHECK_ARGS=(--site "$KNOT_SITE")
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
  # 部署根和仓库分开：仓库只放源码与站点配置稿，releases/、current、var/ 落在部署根。
  # 没写 KNOT_DEPLOY_DIR 时退回旧行为（部署根 = 仓库），只给临时调试用。
  DEPLOY_DIR="$(knot_expand_path "${KNOT_DEPLOY_DIR:-$APP}")"
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
  # 站点配置属于这台机器，不进发布包：先落到部署根，deploy-site.sh 从部署根读它。
  # 部署根还等于仓库时（没配 KNOT_DEPLOY_DIR）不要把自己截断。
  mkdir -p "$DEPLOY_DIR/artifacts" "$DEPLOY_DIR/sites/$KNOT_SITE"
  chmod 700 "$DEPLOY_DIR/sites/$KNOT_SITE"
  if [[ "$(cd "$DEPLOY_DIR/sites/$KNOT_SITE" && pwd -P)" != "$(cd "$KNOT_SITE_DIR" && pwd -P)" ]]; then
    cp "$KNOT_SITE_ENV" "$DEPLOY_DIR/sites/$KNOT_SITE/site.env"
    chmod 600 "$DEPLOY_DIR/sites/$KNOT_SITE/site.env"
    for entry_file in "$KNOT_SITE_DIR"/entry.*.env; do
      [[ -f "$entry_file" ]] || continue
      cp "$entry_file" "$DEPLOY_DIR/sites/$KNOT_SITE/$(basename "$entry_file")"
      chmod 600 "$DEPLOY_DIR/sites/$KNOT_SITE/$(basename "$entry_file")"
    done
  fi
  DEPLOY_ARGS=(--site "$KNOT_SITE" --deploy-root "$DEPLOY_DIR" --artifact "$ARTIFACT")
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
    knot_fail "健康检查没有通过：${VERIFY_URL}。看 $DEPLOY_DIR/var/log/ 里的日志。"
  fi
  curl -sf -o /dev/null -w "web %{http_code}\n" "http://127.0.0.1:$KNOT_PORT/"

  echo "OK: $KNOT_PUBLIC_ORIGIN"
  echo "    $REL_NAME"
  echo "    本机 http://127.0.0.1:$KNOT_PORT"
  if ! knot_enabled KNOT_ENTRY_ENABLED; then
    echo "    KNOT_ENTRY_ENABLED=0：这次没有推公网入口。"
  elif [[ "$PUSH_ENTRY" != 1 ]]; then
    knot_warn "入口没有更新：各入口的静态根还是上一版 dist，而 /api 已经指向新后端。
    要一起推加 --entry：./ops/scripts/push-deploy.sh --site $KNOT_SITE --entry"
  fi
  echo "    登录：./ops/scripts/local-login.sh --site $KNOT_SITE"

  if [[ "$PUSH_ENTRY" == 1 ]]; then
    echo "==> push entry"
    ENTRY_ARGS=(--site "$KNOT_SITE")
    "$SCRIPT_DIR/push-entry.sh" "${ENTRY_ARGS[@]}"
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
# 取最后一行：登录 banner 会混进 stdout，整段当路径会把命令发到奇怪的地方。
REMOTE_HOME="$("${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" 'printf %s "$HOME"' | tail -n 1)"
case "$REMOTE_HOME" in
  /*) ;;
  *)
    knot_fail "目标机返回的 home 不是绝对路径：'${REMOTE_HOME}'。检查 ssh 登录 banner 或 shell 启动脚本的输出。"
    ;;
esac
case "$DEPLOY_DIR" in
  "~") DEPLOY_DIR="$REMOTE_HOME" ;;
  "~/"*) DEPLOY_DIR="$REMOTE_HOME/${DEPLOY_DIR#\~/}" ;;
  "$HOME") DEPLOY_DIR="$REMOTE_HOME" ;;
  "$HOME"/*) DEPLOY_DIR="$REMOTE_HOME${DEPLOY_DIR#"$HOME"}" ;;
esac

# 部署前的版本：健康检查失败时用它把远端切回去。取值走位置参数，
# 不拼进远端 shell 文本。
PREV_REMOTE="$("${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" bash -s -- "$DEPLOY_DIR" <<'REMOTE' | tail -n 1
set -eu
readlink "$1/current" 2>/dev/null || true
REMOTE
)"

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
# 先建一个 600 的空文件再写：`cat > file && chmod 600` 之间文件按 umask（通常 644）
# 存在，里面的 DATABASE_URL 与委托发信令牌在这段时间对同机其他用户可读。
REMOTE_SITE="sites/$KNOT_SITE"
echo "==> site → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_SITE/site.env"
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "install -m 600 /dev/null '$DEPLOY_DIR/$REMOTE_SITE/site.env' && cat > '$DEPLOY_DIR/$REMOTE_SITE/site.env'" <"$KNOT_SITE_ENV"

# 子域入口也随站点走：目标机上的 push-discover.sh 要按入口找静态根，
# 在目标机上补推入口主机时也要读这份文件。
for entry_file in "$KNOT_SITE_DIR"/entry.*.env; do
  [[ -f "$entry_file" ]] || continue
  REMOTE_ENTRY="$REMOTE_SITE/$(basename "$entry_file")"
  echo "==> entry → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_ENTRY"
  "${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "install -m 600 /dev/null '$DEPLOY_DIR/$REMOTE_ENTRY' && cat > '$DEPLOY_DIR/$REMOTE_ENTRY'" <"$entry_file"
done

# ---- 5. 在目标机解包并安装 ----
echo "==> remote install"
# 远端脚本固定走 stdin，值全部用位置参数传：发布包名来自文件名，含一个单引号
# 就能在实例主机上跳出引号、以部署用户执行任意命令，紧接着还是 rm -rf。
# 解包目录也改成 mktemp：同一主机并发部署时不再共用 .incoming/<名字>。
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" bash -s -- \
  "$DEPLOY_DIR" "$REL_NAME" "$ARTIFACT_BASE" "$KNOT_SITE" "${RUNTIME_ARG:-}" <<'REMOTE'
set -eu
deploy_dir="$1"
rel_name="$2"
artifact="$3"
site="$4"
runtime="$5"

case "$rel_name" in
  "" | */* | *..*) echo "发布包名不合法：${rel_name}" >&2; exit 2 ;;
esac
incoming="$(mktemp -d "${deploy_dir}/.incoming/knot-XXXXXX")"
trap 'rm -rf "$incoming"' EXIT
tar -xzf "${deploy_dir}/artifacts/${artifact}" -C "$incoming"
if [ -n "$runtime" ]; then
  KNOT_DEPLOY_ROOT="$deploy_dir" "${incoming}/${rel_name}/ops/scripts/deploy-site.sh" \
    --site "$site" --deploy-root "$deploy_dir" --runtime "$runtime"
else
  KNOT_DEPLOY_ROOT="$deploy_dir" "${incoming}/${rel_name}/ops/scripts/deploy-site.sh" \
    --site "$site" --deploy-root "$deploy_dir"
fi
REMOTE

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
  # 远端已经切了 current，健康检查不过就是 502 一直挂着等人手工回滚。
  # 部署前记下的版本还可用就自动切回去，别把线上停在坏版本。
  PREV_NAME="${PREV_REMOTE#releases/}"
  if [[ -n "$PREV_NAME" && "$PREV_NAME" != "$REL_NAME" ]]; then
    echo "==> 健康检查没过，远端回滚到 ${PREV_NAME}" >&2
    "${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" bash -s -- "$DEPLOY_DIR" "$KNOT_SITE" "$PREV_NAME" <<'REMOTE' || true
set -eu
deploy_dir="$1"
site="$2"
target="$3"
KNOT_DEPLOY_ROOT="$deploy_dir" "$deploy_dir/current/ops/scripts/rollback.sh" --site "$site" --to "$target"
REMOTE
    for _ in $(seq 1 15); do
      if curl -sf "$VERIFY_URL" >/dev/null 2>&1; then
        knot_fail "新版本 ${REL_NAME} 没有通过健康检查，已回滚到 ${PREV_NAME}（现在可达）。看 $DEPLOY_DIR/var/log/。"
      fi
      sleep 1
    done
    knot_fail "新版本 ${REL_NAME} 没有通过健康检查，回滚到 ${PREV_NAME} 后仍不可达：${VERIFY_URL}。"
  fi
  knot_fail "健康检查没有通过：$VERIFY_URL"
fi
curl -sf -o /dev/null -w "web %{http_code}\n" "http://${KNOT_DEPLOY_SSH#*@}:$KNOT_PORT/"
echo "OK: $KNOT_PUBLIC_ORIGIN"
echo "    $REL_NAME"
echo "    实例主机 http://${KNOT_DEPLOY_SSH#*@}:$KNOT_PORT"
if ! knot_enabled KNOT_ENTRY_ENABLED; then
  echo "    KNOT_ENTRY_ENABLED=0：这次没有推公网入口。"
elif [[ "$PUSH_ENTRY" != 1 ]]; then
  # KNOT_ENTRY_ENABLED=1 但没带 --entry：入口仍是上一版页面。
  # 这不算错误（有时只想起实例主机），但接口已经是新的、页面还是旧的，
  # 表现就是「本地能看到内容，公网域名什么都没有」。必须说出来。
  knot_warn "入口没有更新：各入口的静态根还是上一版 dist，而 /api 已经指向新后端。
    要一起推加 --entry：./ops/scripts/push-deploy.sh --site $KNOT_SITE --entry"
fi

if [[ "$PUSH_ENTRY" == 1 ]]; then
  echo "==> push entry"
  "$SCRIPT_DIR/push-entry.sh" --site "$KNOT_SITE"
fi
