#!/usr/bin/env bash
# 把 Knot WebUI 和 nginx 配置推到 xknot.si 子域入口。
#
# 官方只支持一个入口：sites/<站点>/entry.<域名>.env，域名必须是 xknot.si 签发的二级子域。
#   - KNOT_ENTRY_SERVE=static：推 web/dist 到入口的静态根，并装它的 nginx 配置；
#   - KNOT_ENTRY_SERVE=proxy：不推静态，只装 nginx 配置（首页回源到实例）。
#
# 入口主机、回源端口、缓存区与 reload 命令来自 site.env 与这份入口文件。
#
# 用法：
#   ./ops/scripts/push-entry.sh --site wang
#   ./ops/scripts/push-entry.sh --site wang --no-build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SITE_ARG=""
BUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--site 后面要跟站点名" >&2; exit 2; }
      SITE_ARG="$2"
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

# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"

knot_enabled KNOT_ENTRY_ENABLED || knot_fail "当前站点 KNOT_ENTRY_ENABLED=0，是 local 部署，没有 xknot.si 子域入口可推。"
knot_require KNOT_ENTRY_SSH "在 sites/$KNOT_SITE/site.env 里写 KNOT_ENTRY_SSH=user@entry-host。"
knot_require KNOT_DOMAIN "在 sites/$KNOT_SITE/site.env 里写 KNOT_DOMAIN=<标签>.xknot.si。"

# 入口清单与校验都在 config.mjs 里：域名、静态根、证书路径都在那儿看。
node "$SCRIPT_DIR/config.mjs" check --site "$KNOT_SITE"

ENTRY_FILE="$KNOT_SITE_DIR/entry.$KNOT_DOMAIN.env"
[[ -f "$ENTRY_FILE" ]] || knot_fail "找不到入口文件：sites/$KNOT_SITE/entry.$KNOT_DOMAIN.env"
EXTRA_ENTRIES="$(find "$KNOT_SITE_DIR" -maxdepth 1 -name 'entry.*.env' ! -name "entry.$KNOT_DOMAIN.env" -print -quit)"
[[ -z "$EXTRA_ENTRIES" ]] || knot_fail "sites/$KNOT_SITE/ 下只能有一个入口文件，发现多余：$(basename "$EXTRA_ENTRIES")"

if [[ "$BUILD" == 1 ]]; then
  if [[ -x "$KNOT_APP_DIR/node_modules/.bin/vite" ]]; then
    echo "==> build web"
    npm --prefix "$KNOT_APP_DIR" run build:web
  elif [[ -f "$KNOT_APP_DIR/web/dist/index.html" ]]; then
    echo "==> 没有构建工具（发布包），用自带的 web/dist"
  else
    knot_fail "没有 web/dist，也没有 vite。请在源码目录构建，或用 build.sh 产出发布包。"
  fi
fi
[[ -f "$KNOT_APP_DIR/web/dist/index.html" ]] || knot_fail "缺少 web/dist/index.html。"

SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)
ENTRY_KEY="$(knot_expand_path "$KNOT_ENTRY_SSH_KEY")"
if [[ -n "$ENTRY_KEY" ]]; then
  SSH_OPTS+=(-i "$ENTRY_KEY")
fi

knot_render_entry() {
  local out="$1"
  (
    set -a
    # shellcheck source=/dev/null
    source "$KNOT_SITE_ENV"
    # shellcheck source=/dev/null
    source "$ENTRY_FILE"
    # 入口改了 KNOT_DOMAIN，证书等默认值要按这个域名重新推导。
    knot_entry_defaults
    # 模板只认这个开关，不让模板去比较字符串。
    if [[ "${KNOT_ENTRY_SERVE:-static}" == "static" ]]; then
      KNOT_ENTRY_STATIC=1
    else
      KNOT_ENTRY_STATIC=""
    fi
    export KNOT_DOMAIN KNOT_ENTRY_STATIC
    export KNOT_ENTRY_WEB_ROOT KNOT_ENTRY_CONF KNOT_ENTRY_CERT KNOT_ENTRY_KEY
    export KNOT_ENTRY_SSL KNOT_ENTRY_PROXY_PORT KNOT_ENTRY_MAX_BODY
    node "$SCRIPT_DIR/render-config.mjs" "$KNOT_APP_DIR/ops/entry/site.conf.template" "$out"
  )
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/knot-entry.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

HOST="$(knot_entry_value "$ENTRY_FILE" KNOT_DOMAIN)"
SERVE="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_SERVE)"
WEB_ROOT="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_WEB_ROOT)"
CONF="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_CONF)"
SSL="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_SSL)"
SERVE="${SERVE:-static}"

[[ "$HOST" == "$KNOT_DOMAIN" ]] || knot_fail "入口文件名必须是 entry.$KNOT_DOMAIN.env，里面的 KNOT_DOMAIN 现在是 ${HOST}。"

# 缓存区同一台入口主机只声明一次。
if [[ "$SERVE" == "static" ]]; then
  CACHE_CONF="$(dirname "${CONF:-/etc/nginx/conf.d/knot.conf}")/knot-cache.conf"
  node "$SCRIPT_DIR/render-config.mjs" "$KNOT_APP_DIR/ops/entry/cache.conf.template" "$TMP_DIR/knot-cache.conf"
  scp "${SSH_OPTS[@]}" "$TMP_DIR/knot-cache.conf" "$KNOT_ENTRY_SSH:/tmp/knot-cache.conf"
  echo "==> install $CACHE_CONF"
  ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "sudo mkdir -p '$(dirname "$CACHE_CONF")' && sudo cp /tmp/knot-cache.conf '$CACHE_CONF'"
else
  echo "==> proxy 投放，跳过缓存区"
fi

if [[ "$SERVE" == "static" ]]; then
  echo "==> sync web/dist to $KNOT_ENTRY_SSH:/tmp/knot-web/"
  rsync -az --delete \
    -e "ssh ${SSH_OPTS[*]}" \
    "$KNOT_APP_DIR/web/dist/" "$KNOT_ENTRY_SSH:/tmp/knot-web/"
fi

if [[ "$SSL" != "0" ]]; then
  # 只有配置里引用了证书才需要它存在；路径由渲染时的 KNOT_ENTRY_CERT 决定。
  CERT="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_CERT)"
  if [[ -z "$CERT" ]]; then
    knot_warn "入口 $HOST 的证书路径按域名推导为 /etc/letsencrypt/live/$HOST/fullchain.pem，签好之前 nginx -t 会失败。"
  fi
fi

CONF_OUT="$TMP_DIR/$HOST.conf"
knot_render_entry "$CONF_OUT"
scp "${SSH_OPTS[@]}" "$CONF_OUT" "$KNOT_ENTRY_SSH:/tmp/knot-site-$HOST.conf"

CHOWN_CMD=""
if [[ -n "${KNOT_ENTRY_WEB_OWNER:-}" ]]; then
  CHOWN_CMD="sudo chown -R $KNOT_ENTRY_WEB_OWNER '$WEB_ROOT' &&"
fi

echo "==> entry ${HOST}（${SERVE}）"
if [[ "$SERVE" == "static" ]]; then
  echo "    安装静态根 $WEB_ROOT"
  ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "
    set -e
    sudo mkdir -p '$WEB_ROOT'
    sudo rsync -a --delete --exclude .well-known --exclude /discover.json --exclude /media/ /tmp/knot-web/ '$WEB_ROOT/'
    $CHOWN_CMD true
    sudo mkdir -p '$(dirname "$CONF")'
    sudo cp /tmp/knot-site-$HOST.conf '$CONF'
    sudo nginx -t
    $KNOT_ENTRY_RELOAD_CMD
  "
else
  echo "    整站回源，不推静态文件"
  ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "
    set -e
    sudo mkdir -p '$(dirname "$CONF")'
    sudo cp /tmp/knot-site-$HOST.conf '$CONF'
    sudo nginx -t
    $KNOT_ENTRY_RELOAD_CMD
  "
fi

echo
echo "OK: xknot.si 子域入口 $HOST 已更新"
