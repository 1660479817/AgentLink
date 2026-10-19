#!/usr/bin/env bash
# 从开发机把仓库同步到平台主机，再在那边执行 deploy-site.sh。
#
# 目标主机、目录和私钥都来自 sites/<站点>/site.env。脚本里不写死任何 IP。
#
# 用法：
#   ./ops/scripts/push-deploy.sh --site bot01
#   ./ops/scripts/push-deploy.sh --site bot01 --variant local
#   ./ops/scripts/push-deploy.sh --site bot01 --edge     # 部署后再推一次云端边缘
#
# 变体是 site.<变体>.env 叠加层，可以只写和基础配置不同的几项。
# 站点配置不进 rsync，单独拷到平台主机的同路径；platform.env 和 agents/ 留在那台机器上。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SITE_ARG=""
VARIANT_ARG=""
PUSH_EDGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --edge)
      PUSH_EDGE=1
      shift
      ;;
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

# 纯本地部署不该顺带推云端。配置里 KNOT_EDGE=0 时，--edge 直接报错，
# 免得以为在测本地、实际上把边缘改了。
if [[ "$PUSH_EDGE" == 1 ]] && ! knot_enabled KNOT_EDGE; then
  knot_fail "当前站点配置 KNOT_EDGE=0，不能加 --edge。要推边缘请用带 KNOT_EDGE=1 的配置。"
fi

knot_require KNOT_DEPLOY_SSH "在 sites/$KNOT_SITE/site.env 里写 KNOT_DEPLOY_SSH=user@host，或直接在平台主机上跑 deploy-site.sh。"

# 先在开发机校验一遍，别把错的配置同步到平台主机再回滚。
echo "==> config sites/$KNOT_SITE/site.env${KNOT_SITE_VARIANT:+ + site.$KNOT_SITE_VARIANT.env}"
CHECK_ARGS=(--site "$KNOT_SITE")
[[ -n "$KNOT_SITE_VARIANT" ]] && CHECK_ARGS+=(--variant "$KNOT_SITE_VARIANT")
node "$SCRIPT_DIR/config.mjs" check "${CHECK_ARGS[@]}"

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
  --exclude 'sites' \
  -e "$RSYNC_E" \
  "$REPO_ROOT/" "$KNOT_DEPLOY_SSH:$DEPLOY_DIR/"

# 站点配置不进 rsync：它属于这台机器，而且 platform.env 里有密钥。
REMOTE_SITE="sites/$KNOT_SITE"
echo "==> site → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_SITE/site.env"
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "mkdir -p '$DEPLOY_DIR/$REMOTE_SITE' && chmod 700 '$DEPLOY_DIR/$REMOTE_SITE'"
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "cat > '$DEPLOY_DIR/$REMOTE_SITE/site.env' && chmod 600 '$DEPLOY_DIR/$REMOTE_SITE/site.env'" <"$KNOT_SITE_ENV"
if [[ -n "$KNOT_SITE_OVERLAY" ]]; then
  REMOTE_OVERLAY="$REMOTE_SITE/$(basename "$KNOT_SITE_OVERLAY")"
  echo "==> variant → $KNOT_DEPLOY_SSH:$DEPLOY_DIR/$REMOTE_OVERLAY"
  "${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" "cat > '$DEPLOY_DIR/$REMOTE_OVERLAY' && chmod 600 '$DEPLOY_DIR/$REMOTE_OVERLAY'" <"$KNOT_SITE_OVERLAY"
fi

echo "==> remote deploy-site.sh"
"${RUN_SSH[@]}" "$KNOT_DEPLOY_SSH" \
  "cd '$DEPLOY_DIR' && chmod +x ops/scripts/*.sh && KNOT_SITE='$KNOT_SITE' KNOT_SITE_VARIANT='$KNOT_SITE_VARIANT' ./ops/scripts/deploy-site.sh"

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
  EDGE_ARGS=(--site "$KNOT_SITE")
  [[ -n "$KNOT_SITE_VARIANT" ]] && EDGE_ARGS+=(--variant "$KNOT_SITE_VARIANT")
  "$SCRIPT_DIR/push-edge.sh" "${EDGE_ARGS[@]}"
fi
