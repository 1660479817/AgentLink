#!/usr/bin/env bash
# 把 Knot WebUI 和 nginx 配置推到云端边缘。
#
# 目标主机、Web 根目录、配置路径、证书和回源端口都来自 sites/<站点>/site.env。
# 平台仍在平台主机上，/api 和 /help 经隧道（或同机反代）回来。
#
# 用法：
#   ./ops/scripts/push-edge.sh --site bot01
#   ./ops/scripts/push-edge.sh --site bot01 --no-build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SITE_ARG=""
VARIANT_ARG=""
BUILD=1
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
    --no-build)
      BUILD=0
      shift
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

knot_require KNOT_EDGE_SSH "在 sites/$KNOT_SITE/site.env 里写 KNOT_EDGE_SSH=user@edge-host，并把 KNOT_EDGE=1。"
knot_require KNOT_DOMAIN "在 sites/$KNOT_SITE/site.env 里写 KNOT_DOMAIN=你的域名，或让 KNOT_PUBLIC_ORIGIN 带上域名。"

# 边缘配置也是从 site.env 渲染的，先校验再动 nginx。
node "$SCRIPT_DIR/config.mjs" check --site "$KNOT_SITE"
if knot_enabled KNOT_EDGE_SSL; then
  knot_require KNOT_EDGE_CERT "KNOT_EDGE_SSL=1 时要有证书。先签证书，或把 KNOT_EDGE_SSL 设为 0。"
  knot_require KNOT_EDGE_KEY "KNOT_EDGE_SSL=1 时要有私钥。先签证书，或把 KNOT_EDGE_SSL 设为 0。"
fi

if [[ "$BUILD" == 1 ]]; then
  echo "==> build web"
  npm --prefix "$KNOT_REPO_ROOT" run build:web
fi

TMP_CONF="$(mktemp "${TMPDIR:-/tmp}/knot-site.XXXXXX.conf")"
trap 'rm -f "$TMP_CONF"' EXIT

echo "==> render nginx config"
knot_render "$KNOT_REPO_ROOT/ops/edge/site.conf.template" "$TMP_CONF"

SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
EDGE_KEY="$(knot_expand_path "$KNOT_EDGE_SSH_KEY")"
if [[ -n "$EDGE_KEY" ]]; then
  SSH_OPTS+=(-i "$EDGE_KEY")
fi

echo "==> sync dist and config"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  "$KNOT_REPO_ROOT/web/dist/" "$KNOT_EDGE_SSH:/tmp/knot-web/"
scp "${SSH_OPTS[@]}" "$TMP_CONF" "$KNOT_EDGE_SSH:/tmp/knot-site.conf"

CHOWN_CMD=""
if [[ -n "$KNOT_EDGE_WEB_OWNER" ]]; then
  CHOWN_CMD="sudo chown -R $KNOT_EDGE_WEB_OWNER $KNOT_EDGE_WEB_ROOT &&"
fi

echo "==> install site"
ssh "${SSH_OPTS[@]}" "$KNOT_EDGE_SSH" "
  set -e
  sudo mkdir -p '$KNOT_EDGE_WEB_ROOT'
  sudo rsync -a --delete --exclude .well-known --exclude /discover.json --exclude /media/ /tmp/knot-web/ '$KNOT_EDGE_WEB_ROOT/'
  $CHOWN_CMD true
  sudo mkdir -p '$(dirname "$KNOT_EDGE_CONF")'
  sudo cp /tmp/knot-site.conf '$KNOT_EDGE_CONF'
  sudo nginx -t
  $KNOT_EDGE_RELOAD_CMD
"

echo "OK: $KNOT_PUBLIC_ORIGIN"
