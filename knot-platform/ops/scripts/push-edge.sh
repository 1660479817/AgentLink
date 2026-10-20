#!/usr/bin/env bash
# 把 Knot WebUI 和 nginx 配置推到云端边缘。
#
# 一个实例可以有多个公网入口（例如 wang.xknot.si 与 knot.zenheart.net 指向同一个后端），
# 每个入口一份 sites/<站点>/edge.<域名>.env，本脚本逐个处理：
#   - 入口里 KNOT_ENTRY_SERVE=static：推 web/dist 到该入口的静态根，并装它的 nginx 配置；
#   - 入口里 KNOT_ENTRY_SERVE=proxy：不推静态，只装 nginx 配置（首页回源到实例）；
#   - 入口里 KNOT_ENTRY_PUBLISHER=partner：这个入口不归部署脚本管，跳过并说明。
#
# 边缘主机、回源端口、缓存区与 reload 命令仍来自 site.env（同一台边缘共用的部分）。
#
# 用法：
#   ./ops/scripts/push-edge.sh --site bot01
#   ./ops/scripts/push-edge.sh --site bot01 --no-build
#   ./ops/scripts/push-edge.sh --site bot01 --entry wang.xknot.si   # 只推一个入口
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SITE_ARG=""
VARIANT_ARG=""
ENTRY_ARG=""
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
    --entry)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--entry 后面要跟入口域名" >&2; exit 2; }
      ENTRY_ARG="$2"
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

# 入口清单与逐份校验都在 config.mjs 里：一个入口的域名、静态根、conf 冲突都在那儿看。
node "$SCRIPT_DIR/config.mjs" check --site "$KNOT_SITE"

ENTRY_FILES=()
for file in "$KNOT_SITE_DIR"/edge.*.env; do
  [[ -f "$file" ]] || continue
  name="$(basename "$file")"
  name="${name#edge.}"
  name="${name%.env}"
  if [[ -n "$ENTRY_ARG" && "$name" != "$ENTRY_ARG" ]]; then
    continue
  fi
  ENTRY_FILES+=("$file")
done

if [[ ${#ENTRY_FILES[@]} -eq 0 ]]; then
  if [[ -n "$ENTRY_ARG" ]]; then
    knot_fail "找不到入口 ${ENTRY_ARG}：sites/$KNOT_SITE/edge.$ENTRY_ARG.env 不存在。"
  fi
  knot_fail "sites/$KNOT_SITE/ 下没有 edge.<域名>.env。KNOT_EDGE=1 时至少要有规范入口那一份：
  cp sites/_template/edge.<域名>.env sites/$KNOT_SITE/edge.\$KNOT_DOMAIN.env"
fi

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
EDGE_KEY="$(knot_expand_path "$KNOT_EDGE_SSH_KEY")"
if [[ -n "$EDGE_KEY" ]]; then
  SSH_OPTS+=(-i "$EDGE_KEY")
fi

# 每个入口沿用 site.env 的值，再压一层自己的覆盖；函数里改的环境不带到下一个入口。
knot_render_entry() {
  local entry_file="$1" out="$2"
  (
    set -a
    # shellcheck source=/dev/null
    source "$KNOT_SITE_ENV"
    if [[ -n "$KNOT_SITE_OVERLAY" ]]; then
      # shellcheck source=/dev/null
      source "$KNOT_SITE_OVERLAY"
    fi
    # shellcheck source=/dev/null
    source "$entry_file"
    # 入口改了 KNOT_DOMAIN，证书等默认值要按这个域名重新推导。
    knot_edge_defaults
    # 模板只认这个开关，不让模板去比较字符串。
    if [[ "${KNOT_ENTRY_SERVE:-static}" == "static" ]]; then
      KNOT_ENTRY_STATIC=1
    else
      KNOT_ENTRY_STATIC=""
    fi
    export KNOT_DOMAIN KNOT_ENTRY_STATIC
    export KNOT_EDGE_WEB_ROOT KNOT_EDGE_CONF KNOT_EDGE_CERT KNOT_EDGE_KEY
    export KNOT_EDGE_SSL KNOT_EDGE_PROXY_PORT KNOT_EDGE_MAX_BODY
    node "$SCRIPT_DIR/render-config.mjs" "$KNOT_APP_DIR/ops/edge/site.conf.template" "$out"
  )
}

# 缓存区整台边缘只声明一次：多个入口共用同一个 zone，各写一份会让 nginx -t 报重复。
# 只要有入口是 static 就装；装在第一个 static 入口的 conf 同目录下，名字固定。
knot_install_cache_zone() {
  local i file first_static="" static_conf=""
  for ((i = 0; i < ${#ENTRY_FILES[@]}; i++)); do
    file="${ENTRY_FILES[$i]}"
    if [[ -z "$first_static" && "$(knot_entry_value "$file" KNOT_ENTRY_SERVE)" != "proxy" ]]; then
      first_static="$file"
      static_conf="$(knot_entry_value "$file" KNOT_EDGE_CONF)"
    fi
  done
  if [[ -z "$first_static" ]]; then
    echo "==> 没有 static 入口，跳过缓存区"
    return 0
  fi
  local cache_conf="$(dirname "${static_conf:-/etc/nginx/conf.d/knot.conf}")/knot-cache.conf"
  node "$SCRIPT_DIR/render-config.mjs" "$KNOT_APP_DIR/ops/edge/cache.conf.template" "$TMP_DIR/knot-cache.conf"
  scp "${SSH_OPTS[@]}" "$TMP_DIR/knot-cache.conf" "$KNOT_EDGE_SSH:/tmp/knot-cache.conf"
  echo "==> install $cache_conf"
  ssh "${SSH_OPTS[@]}" "$KNOT_EDGE_SSH" "sudo mkdir -p '$(dirname "$cache_conf")' && sudo cp /tmp/knot-cache.conf '$cache_conf'"
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/knot-edge.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> sync web/dist to $KNOT_EDGE_SSH:/tmp/knot-web/"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  "$KNOT_APP_DIR/web/dist/" "$KNOT_EDGE_SSH:/tmp/knot-web/"

knot_install_cache_zone

for ((i = 0; i < ${#ENTRY_FILES[@]}; i++)); do
  entry_file="${ENTRY_FILES[$i]}"
  host="$(knot_entry_value "$entry_file" KNOT_DOMAIN)"
  serve="$(knot_entry_value "$entry_file" KNOT_ENTRY_SERVE)"
  publisher="$(knot_entry_value "$entry_file" KNOT_ENTRY_PUBLISHER)"
  web_root="$(knot_entry_value "$entry_file" KNOT_EDGE_WEB_ROOT)"
  conf="$(knot_entry_value "$entry_file" KNOT_EDGE_CONF)"
  ssl="$(knot_entry_value "$entry_file" KNOT_EDGE_SSL)"
  serve="${serve:-static}"
  publisher="${publisher:-staff}"

  echo
  echo "==> entry ${host}（${serve}，发布方 ${publisher}）"

  if [[ "$publisher" == "partner" ]]; then
    echo "    跳过：这个入口的 WebUI 由伙伴自己 rsync，部署脚本不动它的静态根与 conf。"
    continue
  fi

  if [[ "$ssl" != "0" ]]; then
    # 只有配置里引用了证书才需要它存在；路径由渲染时的 KNOT_EDGE_CERT 决定，
    # 这里只做一次存在性提示，不覆盖配置里的值。
    cert="$(knot_entry_value "$entry_file" KNOT_EDGE_CERT)"
    if [[ -z "$cert" ]]; then
      knot_warn "入口 $host 的证书路径按域名推导为 /etc/letsencrypt/live/$host/fullchain.pem，签好之前 nginx -t 会失败。"
    fi
  fi

  conf_out="$TMP_DIR/$host.conf"
  knot_render_entry "$entry_file" "$conf_out"
  scp "${SSH_OPTS[@]}" "$conf_out" "$KNOT_EDGE_SSH:/tmp/knot-site-$host.conf"

  CHOWN_CMD=""
  if [[ -n "${KNOT_EDGE_WEB_OWNER:-}" ]]; then
    CHOWN_CMD="sudo chown -R $KNOT_EDGE_WEB_OWNER '$web_root' &&"
  fi

  # 每个入口只装自己的 conf：名字取自入口，不会顶掉同机的其它子域。
  if [[ "$serve" == "static" ]]; then
    echo "    安装静态根 $web_root"
    ssh "${SSH_OPTS[@]}" "$KNOT_EDGE_SSH" "
      set -e
      sudo mkdir -p '$web_root'
      sudo rsync -a --delete --exclude .well-known --exclude /discover.json --exclude /media/ /tmp/knot-web/ '$web_root/'
      $CHOWN_CMD true
      sudo mkdir -p '$(dirname "$conf")'
      sudo cp /tmp/knot-site-$host.conf '$conf'
      sudo nginx -t
      $KNOT_EDGE_RELOAD_CMD
    "
  else
    echo "    整站回源，不推静态文件"
    ssh "${SSH_OPTS[@]}" "$KNOT_EDGE_SSH" "
      set -e
      sudo mkdir -p '$(dirname "$conf")'
      sudo cp /tmp/knot-site-$host.conf '$conf'
      sudo nginx -t
      $KNOT_EDGE_RELOAD_CMD
    "
  fi
done

echo
echo "OK: 边缘入口 ${#ENTRY_FILES[@]} 个已处理"
