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
    export KNOT_ENTRY_SSL KNOT_ENTRY_PROXY_PORT KNOT_ENTRY_MAX_BODY KNOT_ENTRY_ACCESS_LOG
    node "$SCRIPT_DIR/render-config.mjs" "$KNOT_APP_DIR/ops/entry/site.conf.template" "$out"
  )
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/knot-entry.XXXXXX")"

# 远端中转目录要在入口主机上建，路径本地算不出来，所以两条清理放在同一个 trap 里。
# 中转目录装完即删：它是 0700，留着只会堆 /tmp，也不该让别人在里面翻到还没上线的页面。
cleanup() {
  rm -rf "$TMP_DIR"
  if [[ -n "${REMOTE_STAGE:-}" ]]; then
    ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "rm -rf '${REMOTE_STAGE}'" >/dev/null 2>&1 || true
  fi
  return 0
}
trap cleanup EXIT

HOST="$(knot_entry_value "$ENTRY_FILE" KNOT_DOMAIN)"
SERVE="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_SERVE)"
WEB_ROOT="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_WEB_ROOT)"
CONF="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_CONF)"
SSL="$(knot_entry_value "$ENTRY_FILE" KNOT_ENTRY_SSL)"
SERVE="${SERVE:-static}"

[[ "$HOST" == "$KNOT_DOMAIN" ]] || knot_fail "入口文件名必须是 entry.$KNOT_DOMAIN.env，里面的 KNOT_DOMAIN 现在是 ${HOST}。"

# 静态根与 conf 得是这个子域自己的。留空时 site-config.sh 会回落到 /var/www/knot，
# 那是同一台入口主机上所有子域共用的一份；两个子域都落在那儿，下面的 rsync --delete
# 与 cp 就互相覆盖。先拦下，别等文件已经换掉了才发现。
knot_require_entry_paths "$WEB_ROOT" "$CONF" "$HOST"

# 远端中转目录一次一换。一台入口主机常常同时服务多个子域：固定用 /tmp/knot-web 时，
# 两次推送共用同一份暂存，后到的 rsync --delete 会把先到的 dist 清走，而安装动作是
# sudo rsync 落进系统目录——装进去的可能正是别人刚传上来的页面。mktemp 建的目录是
# 0700，别人也预置不了同名目录。取最后一行：登录 banner 会混进 stdout。
REMOTE_STAGE="$(ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" 'mktemp -d /tmp/knot-entry.XXXXXX' | tail -n 1)"
case "$REMOTE_STAGE" in
  /*) ;;
  *) knot_fail "入口主机没有返回可用的中转目录：'${REMOTE_STAGE}'" ;;
esac
# 下面要把它拼进 root 执行的命令里，只认自己验证过的字符集。
case "$REMOTE_STAGE" in
  *[!A-Za-z0-9._/-]*) knot_fail "中转目录路径里有意外字符：'${REMOTE_STAGE}'" ;;
esac

# 访问日志格式同一台入口主机只声明一次：log_format 重复定义会让整份配置过不了 nginx -t。
# static 与 proxy 都要装，日志才分得出子域。先把文件传到中转目录，落地放在最后一步，
# 和 site.conf 一起过 nginx -t —— 单独落地一个错的 log_format，下一次 reload 才炸。
LOG_CONF="$(dirname "${CONF:-/etc/nginx/conf.d/knot.conf}")/knot-log.conf"
scp "${SSH_OPTS[@]}" "$KNOT_APP_DIR/ops/entry/log.conf.template" "$KNOT_ENTRY_SSH:$REMOTE_STAGE/knot-log.conf"

# 真实客户端地址也是 http 级的：同一台入口主机上所有子域共用同一组 CF 网段，
# 每个子域各声明一遍会互相覆盖，所以同样只装一份。
REALIP_CONF="$(dirname "${CONF:-/etc/nginx/conf.d/knot.conf}")/knot-realip.conf"
scp "${SSH_OPTS[@]}" "$KNOT_APP_DIR/ops/entry/realip.conf" "$KNOT_ENTRY_SSH:$REMOTE_STAGE/knot-realip.conf"

# 缓存区同一台入口主机只声明一次。
CACHE_CONF=""
if [[ "$SERVE" == "static" ]]; then
  CACHE_CONF="$(dirname "${CONF:-/etc/nginx/conf.d/knot.conf}")/knot-cache.conf"
  node "$SCRIPT_DIR/render-config.mjs" "$KNOT_APP_DIR/ops/entry/cache.conf.template" "$TMP_DIR/knot-cache.conf"
  scp "${SSH_OPTS[@]}" "$TMP_DIR/knot-cache.conf" "$KNOT_ENTRY_SSH:$REMOTE_STAGE/knot-cache.conf"
else
  echo "==> proxy 投放，跳过缓存区"
fi

if [[ "$SERVE" == "static" ]]; then
  echo "==> sync web/dist to $KNOT_ENTRY_SSH:$REMOTE_STAGE/web/"
  rsync -az --delete \
    -e "ssh ${SSH_OPTS[*]}" \
    "$KNOT_APP_DIR/web/dist/" "$KNOT_ENTRY_SSH:$REMOTE_STAGE/web/"

  # 构建产物只有 SPA 空壳：首页标题、介绍、OG 都靠 JS 之后才有。
  # 推到入口时补一份静态化的首页，搜索与分享预览才读得到；顺带生成 robots 与 sitemap。
  # proxy 投放不在这里做：那种入口的页面由 Backend 发，改了本地文件也送不出去。
  if [[ "$SSL" == "0" ]]; then ENTRY_ORIGIN="http://$HOST"; else ENTRY_ORIGIN="https://$HOST"; fi
  echo "==> 生成入口首页与 robots/sitemap（${ENTRY_ORIGIN}）"
  node "$SCRIPT_DIR/entry-html.mjs" \
    --in "$KNOT_APP_DIR/web/dist/index.html" \
    --out "$TMP_DIR/entry" \
    --origin "$ENTRY_ORIGIN" \
    --profile "$KNOT_SITE_DIR/profile.json" \
    --name "${HOST%%.*}"
  scp "${SSH_OPTS[@]}" \
    "$TMP_DIR/entry/index.html" "$TMP_DIR/entry/robots.txt" "$TMP_DIR/entry/sitemap.xml" \
    "$KNOT_ENTRY_SSH:$REMOTE_STAGE/web/"
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
scp "${SSH_OPTS[@]}" "$CONF_OUT" "$KNOT_ENTRY_SSH:$REMOTE_STAGE/site.conf"

echo "==> entry ${HOST}（${SERVE}）"
# 配置不能「先落地再校验」：nginx -t 不过时坏 conf 已经躺在 conf.d/ 里，
# 当前运行的 nginx 还是旧配置，但下一次任何 reload（证书续期、别人推入口）
# 都会失败。这里改成 备份 → 落地 → nginx -t → 通过才 reload，失败就整组还原。
# site.conf、log、cache 三份一起测，避免 log_format 重复这类错误漏到下一次。
# reload 命令带空格（如 `sudo systemctl reload nginx`），塞进位置参数会被远端 ssh
# 重新拆词，后面的参数全部错位；改成主脚本跑完、确认成功后再单独发一条命令。
ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" bash -s -- \
  "$SERVE" "$REMOTE_STAGE" "$WEB_ROOT" "$CONF" "$LOG_CONF" "$CACHE_CONF" \
  "${KNOT_ENTRY_WEB_OWNER:-}" "${KNOT_ENTRY_ACCESS_LOG:-/var/log/nginx/knot-access.log}" \
  "$REALIP_CONF" <<'REMOTE'
set -eu
serve="$1"
stage="$2"
web_root="$3"
conf="$4"
log_conf="$5"
cache_conf="$6"
owner="$7"
access_log="$8"
realip_conf="$9"

if [ "$serve" = "static" ]; then
  echo "    安装静态根 ${web_root}"
  sudo mkdir -p "$web_root"
  sudo rsync -a --delete --exclude .well-known --exclude /discover.json --exclude /media/ "$stage/web/" "$web_root/"
  if [ -n "$owner" ]; then sudo chown -R "$owner" "$web_root"; fi
else
  echo "    整站回源，不推静态文件"
fi

prev="$stage/prev"
mkdir -p "$prev"
backup_conf() {
  [ -n "$1" ] || return 0
  if [ -f "$1" ]; then sudo cp -p "$1" "$prev/$(basename "$1")"; fi
}
restore_conf() {
  [ -n "$1" ] || return 0
  if [ -f "$prev/$(basename "$1")" ]; then
    sudo cp -p "$prev/$(basename "$1")" "$1"
  else
    sudo rm -f "$1"
  fi
}
install_conf() {
  sudo mkdir -p "$(dirname "$2")"
  sudo install -m 644 "$1" "$2"
}

backup_conf "$log_conf"
backup_conf "$cache_conf"
backup_conf "$realip_conf"
backup_conf "$conf"
install_conf "$stage/knot-log.conf" "$log_conf"
[ -n "$cache_conf" ] && install_conf "$stage/knot-cache.conf" "$cache_conf"
install_conf "$stage/knot-realip.conf" "$realip_conf"
install_conf "$stage/site.conf" "$conf"
sudo touch "$access_log"

if ! sudo nginx -t; then
  restore_conf "$conf"
  restore_conf "$cache_conf"
  restore_conf "$log_conf"
  restore_conf "$realip_conf"
  echo "nginx -t 没通过，已把入口配置还原成推送前的样子。常见原因：证书没签好、端口被占、域名写错。" >&2
  exit 1
fi
REMOTE

# 主脚本成功（含 nginx -t 通过）才 reload：把整条命令作为单个参数交给 ssh，
# 由远端 shell 自己拆词，带空格的自定义命令也能原样执行。
ssh "${SSH_OPTS[@]}" "$KNOT_ENTRY_SSH" "${KNOT_ENTRY_RELOAD_CMD:-sudo systemctl reload nginx}"

echo
echo "OK: xknot.si 子域入口 $HOST 已更新"
