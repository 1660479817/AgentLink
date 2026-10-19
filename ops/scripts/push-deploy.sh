#!/usr/bin/env bash
# 从开发机把仓库同步到平台主机，再在那边执行 deploy-site.sh。
#
# 目标主机、目录和私钥都来自部署配置。脚本里不写死任何 IP。
#
# 用法：
#   ./ops/scripts/push-deploy.sh                        # 用 ops/deploy.env
#   ./ops/scripts/push-deploy.sh --profile local        # 用 ops/profiles/local.local.env
#   ./ops/scripts/push-deploy.sh --edge                 # 部署后再推一次云端边缘
#   ./ops/scripts/push-deploy.sh --profile local --edge # 两者可以一起用，但纯本地部署不要带 --edge
#
# 一份 profile 就是一个站点：它自己的对外地址、端口、Cookie 名和边缘开关。
# profile 文件不进版本库，部署时单独拷到平台主机的同名路径。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROFILE=""
PUSH_EDGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --edge)
      PUSH_EDGE=1
      shift
      ;;
    --profile)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--profile 后面要跟 profile 名" >&2; exit 2; }
      PROFILE="$2"
      shift 2
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$PROFILE" ]]; then
  KNOT_DEPLOY_ENV="$REPO_ROOT/ops/profiles/$PROFILE.local.env"
  if [[ ! -f "$KNOT_DEPLOY_ENV" ]]; then
    echo "找不到 profile：ops/profiles/$PROFILE.local.env" >&2
    exit 2
  fi
  export KNOT_DEPLOY_ENV
fi

# shellcheck source=lib/deploy-config.sh
source "$SCRIPT_DIR/lib/deploy-config.sh"

# 纯本地部署不该顺带推云端。配置里 KNOT_EDGE=0 时，--edge 直接报错，
# 免得以为在测本地、实际上把边缘改了。
if [[ "$PUSH_EDGE" == 1 ]] && ! knot_enabled KNOT_EDGE; then
  knot_fail "当前配置 KNOT_EDGE=0，不能加 --edge。要推边缘请用带 KNOT_EDGE=1 的 profile。"
fi

knot_require KNOT_DEPLOY_SSH "在部署配置里写 KNOT_DEPLOY_SSH=user@host，或直接在平台主机上跑 deploy-site.sh。"

# 先在开发机校验一遍，别把错的配置同步到平台主机再回滚。
echo "==> config $(basename "$KNOT_DEPLOY_ENV")"
node "$SCRIPT_DIR/config.mjs" check --deploy "$KNOT_DEPLOY_ENV"

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

echo "==> rsync → $KNOT_DEPLOY_SSH:$DEPLOY_DIR"
rsync -avz --delete \
  --exclude node_modules \
  --exclude var \
  --exclude data/uploads \
  --exclude .git \
  --exclude .tmp-review \
  --exclude .tmp-verify \
  --exclude 'ops/env/*.local.env' \
  --exclude 'ops/profiles/*.local.env' \
  -e "$RSYNC_E" \
  "$KNOT_REPO_ROOT/" "$KNOT_DEPLOY_SSH:$DEPLOY_DIR/"

# profile 不进仓库，也不进 rsync，单独拷过去。远端 deploy-site.sh 用它算站点取值。
REMOTE_ENV=""
if [[ -n "$PROFILE" ]]; then
  REMOTE_ENV="ops/profiles/$PROFILE.local.env"
  echo "==> profile → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_ENV"
  "${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "mkdir -p '$DEPLOY_DIR/ops/profiles' && chmod 700 '$DEPLOY_DIR/ops/profiles'"
  "${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "cat > '$DEPLOY_DIR/$REMOTE_ENV' && chmod 600 '$DEPLOY_DIR/$REMOTE_ENV'" <"$KNOT_DEPLOY_ENV"
fi

if [[ -n "$REMOTE_ENV" ]]; then
  echo "==> remote deploy-site.sh ($REMOTE_ENV)"
else
  echo "==> remote deploy-site.sh"
fi
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" \
  "cd '$DEPLOY_DIR' && chmod +x ops/scripts/*.sh && KNOT_DEPLOY_ENV='${REMOTE_ENV:-ops/deploy.env}' ./ops/scripts/deploy-site.sh"

VERIFY_URL="$KNOT_DEPLOY_VERIFY_URL"
if [[ -z "$VERIFY_URL" ]]; then
  VERIFY_URL="http://${KNOT_DEPLOY_SSH#*@}:$KNOT_PORT/api/health"
fi

echo "==> verify $VERIFY_URL"
verified=0
for _ in $(seq 1 20); do
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
echo "    平台主机 http://${KNOT_DEPLOY_SSH#*@}:$KNOT_PORT"
if ! knot_enabled KNOT_EDGE; then
  echo "    KNOT_EDGE=0：这次没有推云端边缘。"
fi

if [[ "$PUSH_EDGE" == 1 ]]; then
  echo "==> push edge"
  "$SCRIPT_DIR/push-edge.sh"
fi
